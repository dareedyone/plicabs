import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getObsEventHub,
	type ObsEventHub,
	type ObsHubEvent,
	type ObsSnapshot
} from '#lib/server/obs/events.js';
import { GET } from './+server';
import type { RequestEvent } from './$types';

vi.mock('$app/env/private', () => ({
	OBS_HOST: 'obs-host.test',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'test-password'
}));

const snapshot: ObsSnapshot = {
	connection: { state: 'connected', lastError: null },
	recording: {
		active: true,
		paused: false,
		timecode: '00:00:01.000',
		durationMs: 1000,
		fileName: 'take.mkv'
	},
	scenes: { scenes: ['Cam'], currentScene: 'Cam' }
};

function fakeHub() {
	const listeners = new Set<(event: ObsHubEvent) => void>();
	const hub = {
		subscribe: vi.fn((listener: (event: ObsHubEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}),
		snapshot: vi.fn(async () => snapshot),
		emit(event: ObsHubEvent) {
			for (const listener of listeners) {
				listener(event);
			}
		},
		get size() {
			return listeners.size;
		}
	};
	return hub;
}

vi.mock('#lib/server/obs/events.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/server/obs/events.js')>();
	return { ...actual, getObsEventHub: vi.fn() };
});

async function openStream() {
	const hub = fakeHub();
	vi.mocked(getObsEventHub).mockReturnValue(hub as unknown as ObsEventHub);
	const abort = new AbortController();
	const response = await GET({
		request: new Request('http://app/api/obs/events', { signal: abort.signal })
	} as RequestEvent);
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('missing body');
	}
	return { hub, response, abort, reader, buffered: { text: '' } };
}

async function readFrames(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	buffered: { text: string },
	count: number
): Promise<string> {
	const decoder = new TextDecoder();
	while ((buffered.text.match(/^event:/gm) ?? []).length < count) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffered.text += decoder.decode(value, { stream: true });
	}
	return buffered.text;
}

afterEach(() => {
	vi.mocked(getObsEventHub).mockReset();
	vi.useRealTimers();
});

describe('GET /api/obs/events', () => {
	it('returns an event-stream and writes a snapshot first', async () => {
		const { response, reader, buffered } = await openStream();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		expect(response.headers.get('cache-control')).toBe('no-cache');

		const text = await readFrames(reader, buffered, 1);
		expect(text).toContain('event: snapshot');
		expect(text).toContain('"fileName":"take.mkv"');
		expect(text).not.toContain('test-password');
		await reader.cancel();
	});

	it('forwards later hub events as named SSE frames', async () => {
		const { hub, reader, buffered } = await openStream();
		await readFrames(reader, buffered, 1);

		hub.emit({
			type: 'connection',
			data: { state: 'disconnected', lastError: 'OBS_UNAVAILABLE' }
		});

		const text = await readFrames(reader, buffered, 2);
		expect(text).toContain('event: connection');
		expect(text).toContain('"state":"disconnected"');
		await reader.cancel();
	});

	it('unsubscribes and stops keepalive when the stream is cancelled', async () => {
		vi.useFakeTimers();
		const { hub, reader, buffered } = await openStream();
		await readFrames(reader, buffered, 1);
		expect(hub.size).toBe(1);

		await reader.cancel();
		expect(hub.size).toBe(0);

		await vi.advanceTimersByTimeAsync(20_000);
		expect(hub.size).toBe(0);
	});

	it('unsubscribes when the request is aborted', async () => {
		const { hub, abort, reader, buffered } = await openStream();
		await readFrames(reader, buffered, 1);
		expect(hub.size).toBe(1);

		abort.abort();
		expect(hub.size).toBe(0);
		await reader.cancel().catch(() => undefined);
	});
});
