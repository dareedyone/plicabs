import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OBSEventTypes } from 'obs-websocket-js';
import type { ObsConnectionStatus } from './connection';
import {
	ObsEventHub,
	RECORDING_POLL_MS,
	RECONNECT_BACKOFF_MS,
	type ObsHubConnection,
	type ObsHubEvent
} from './events';
import { rememberRecordingFile, resetRecordingFileCache, type RecordingStatus } from './recording';
import type { SceneList } from './scenes';

vi.mock('$app/env/private', () => ({
	OBS_HOST: '127.0.0.1',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'env-test-password'
}));

const idle: RecordingStatus = {
	active: false,
	paused: false,
	timecode: '00:00:00.000',
	durationMs: 0,
	fileName: null
};

const live: RecordingStatus = {
	...idle,
	active: true,
	durationMs: 1_000,
	timecode: '00:00:01.000'
};

const scenes: SceneList = { scenes: ['Cam', 'Screen'], currentScene: 'Cam' };

function createFakeConnection(
	initial: ObsConnectionStatus = { state: 'disconnected', lastError: null }
) {
	let status = initial;
	const statusListeners = new Set<(next: ObsConnectionStatus) => void>();
	const obsHandlers = new Map<string, (payload: never) => void>();

	const connection: ObsHubConnection = {
		get status() {
			return status;
		},
		isConnected() {
			return status.state === 'connected';
		},
		connect: vi.fn(async () => {
			status = { state: 'connected', lastError: null };
			for (const listener of statusListeners) {
				listener(status);
			}
		}),
		onStatus(listener) {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		onObsEvent(event, handler) {
			obsHandlers.set(event, handler as (payload: never) => void);
			return () => {
				obsHandlers.delete(event);
			};
		}
	};

	return {
		connection,
		emitStatus(next: ObsConnectionStatus) {
			status = next;
			for (const listener of statusListeners) {
				listener(next);
			}
		},
		emitObs<K extends keyof OBSEventTypes>(event: K, payload: OBSEventTypes[K]) {
			obsHandlers.get(event)?.(payload as never);
		}
	};
}

function createHub(
	overrides: {
		connection?: ReturnType<typeof createFakeConnection>['connection'];
		readRecording?: () => Promise<RecordingStatus>;
		readScenes?: () => Promise<SceneList>;
	} = {}
) {
	const fake = createFakeConnection();
	const readRecording = overrides.readRecording ?? vi.fn(async () => idle);
	const readScenes = overrides.readScenes ?? vi.fn(async () => scenes);
	const hub = new ObsEventHub({
		connection: overrides.connection ?? fake.connection,
		readRecording,
		readScenes
	});
	return { hub, fake, readRecording, readScenes };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	resetRecordingFileCache();
});

describe('ObsEventHub', () => {
	it('sends a snapshot after connecting and reading current OBS state', async () => {
		const { hub, fake, readRecording, readScenes } = createHub({
			readRecording: vi.fn(async () => live)
		});

		const snapshot = await hub.snapshot();

		expect(fake.connection.connect).toHaveBeenCalledTimes(1);
		expect(readRecording).toHaveBeenCalled();
		expect(readScenes).toHaveBeenCalled();
		expect(snapshot).toEqual({
			connection: { state: 'connected', lastError: null },
			recording: live,
			scenes
		});
	});

	it('keeps the snapshot available when OBS is down', async () => {
		const fake = createFakeConnection({ state: 'disconnected', lastError: 'OBS_UNAVAILABLE' });
		vi.mocked(fake.connection.connect).mockRejectedValue(new Error('down'));
		const hub = new ObsEventHub({
			connection: fake.connection,
			readRecording: vi.fn(async () => idle),
			readScenes: vi.fn(async () => scenes)
		});

		await expect(hub.snapshot()).resolves.toEqual({
			connection: { state: 'disconnected', lastError: 'OBS_UNAVAILABLE' },
			recording: null,
			scenes: null
		});
	});

	it('broadcasts normalized recording updates and caches the live basename', async () => {
		const readRecording = vi.fn(async () => ({
			...live,
			fileName: rememberRecordingFile('/Users/demo/Movies/take.mkv', true)
		}));
		const { hub, fake } = createHub({ readRecording });
		const events: ObsHubEvent[] = [];
		const unsubscribe = hub.subscribe((event) => events.push(event));
		await hub.snapshot();
		events.length = 0;

		fake.emitObs('RecordFileChanged', { newOutputPath: '/Users/demo/Movies/take.mkv' });
		await Promise.resolve();

		const recordingEvents = events.filter((event) => event.type === 'recording');
		expect(recordingEvents.at(-1)?.data).toMatchObject({ fileName: 'take.mkv' });
		expect(JSON.stringify(events)).not.toContain('/Users/demo');
		unsubscribe();
	});

	it('treats RecordStateChanged as a refresh, not as a duration source', async () => {
		const readRecording = vi.fn(async () => ({ ...live, durationMs: 4_000 }));
		const { hub, fake } = createHub({ readRecording });
		const unsubscribe = hub.subscribe(() => {});
		await hub.snapshot();
		readRecording.mockClear();

		fake.emitObs('RecordStateChanged', {
			outputActive: true,
			outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
			outputPath: ''
		});
		await Promise.resolve();

		expect(readRecording).toHaveBeenCalled();
		unsubscribe();
	});

	it('does not retry after an authentication failure', async () => {
		const fake = createFakeConnection({ state: 'disconnected', lastError: 'OBS_AUTH_FAILED' });
		vi.mocked(fake.connection.connect).mockRejectedValue(new Error('auth'));
		const hub = new ObsEventHub({
			connection: fake.connection,
			readRecording: async () => idle,
			readScenes: async () => scenes
		});
		hub.subscribe(() => {});
		await hub.snapshot();
		vi.mocked(fake.connection.connect).mockClear();

		await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[2] * 2);

		expect(fake.connection.connect).not.toHaveBeenCalled();
	});

	it('reconnects with bounded backoff while subscribers exist', async () => {
		const fake = createFakeConnection({ state: 'disconnected', lastError: 'OBS_UNAVAILABLE' });
		vi.mocked(fake.connection.connect).mockRejectedValue(new Error('down'));
		const hub = new ObsEventHub({
			connection: fake.connection,
			readRecording: async () => idle,
			readScenes: async () => scenes
		});
		hub.subscribe(() => {});
		await hub.snapshot();
		vi.mocked(fake.connection.connect).mockClear();

		await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[0]);
		expect(fake.connection.connect).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[1]);
		expect(fake.connection.connect).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[2]);
		expect(fake.connection.connect).toHaveBeenCalledTimes(3);

		await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS[2]);
		expect(fake.connection.connect).toHaveBeenCalledTimes(4);
	});

	it('stops reconnect and polling when the last subscriber leaves', async () => {
		const readRecording = vi.fn(async () => live);
		const { hub, fake } = createHub({ readRecording });
		const unsubscribe = hub.subscribe(() => {});
		await hub.snapshot();
		expect(hub.subscriberCount).toBe(1);

		await vi.advanceTimersByTimeAsync(RECORDING_POLL_MS);
		const callsWhileSubscribed = vi.mocked(readRecording).mock.calls.length;
		unsubscribe();

		fake.emitStatus({ state: 'disconnected', lastError: 'OBS_UNAVAILABLE' });
		await vi.advanceTimersByTimeAsync(RECORDING_POLL_MS + RECONNECT_BACKOFF_MS[2]);

		expect(hub.subscriberCount).toBe(0);
		expect(vi.mocked(readRecording).mock.calls.length).toBe(callsWhileSubscribed);
		expect(fake.connection.connect).toHaveBeenCalledTimes(1);
	});

	it('polls GetRecordStatus about once per second only while recording', async () => {
		const readRecording = vi.fn(async () => live);
		const { hub } = createHub({ readRecording });
		hub.subscribe(() => {});
		await hub.snapshot();
		readRecording.mockClear();

		await vi.advanceTimersByTimeAsync(RECORDING_POLL_MS * 3);
		expect(readRecording).toHaveBeenCalledTimes(3);

		readRecording.mockResolvedValue(idle);
		await vi.advanceTimersByTimeAsync(RECORDING_POLL_MS);
		readRecording.mockClear();
		await vi.advanceTimersByTimeAsync(RECORDING_POLL_MS * 2);
		expect(readRecording).not.toHaveBeenCalled();
	});

	it('attaches OBS listeners only once for multiple subscribers', async () => {
		const { hub, fake } = createHub();
		const onObsEvent = vi.spyOn(fake.connection, 'onObsEvent');
		hub.subscribe(() => {});
		hub.subscribe(() => {});
		await hub.snapshot();

		const recordListeners = onObsEvent.mock.calls.filter(
			([event]) => event === 'RecordStateChanged'
		);
		expect(recordListeners).toHaveLength(1);
	});
});
