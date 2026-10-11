import OBSWebSocket, { OBSWebSocketError, type OBSResponseTypes } from 'obs-websocket-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getObsConnection, ObsConnection, ObsConnectionError } from './connection';
import { getRecordingStatus, startRecording, stopRecording } from './recording';

vi.mock('$app/env/private', () => ({
	OBS_HOST: '127.0.0.1',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'env-test-password'
}));

const PASSWORD = 'test-password';

type ConnectResult = Awaited<ReturnType<OBSWebSocket['connect']>>;
const connectResult = { obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 } as ConnectResult;

type RecordStatus = OBSResponseTypes['GetRecordStatus'];

function recordStatus(active: boolean): RecordStatus {
	return {
		outputActive: active,
		outputPaused: false,
		outputTimecode: active ? '00:00:01.000' : '00:00:00.000',
		outputDuration: active ? 1000 : 0,
		outputBytes: 0
	};
}

function createStubClient(initiallyActive = false) {
	const client = new OBSWebSocket();
	let identified = false;
	let active = initiallyActive;

	vi.spyOn(client, 'identified', 'get').mockImplementation(() => identified);
	const connect = vi.spyOn(client, 'connect').mockImplementation(async () => {
		identified = true;
		return connectResult;
	});
	const call = vi.spyOn(client, 'call').mockImplementation(async (type) => {
		if (type === 'GetRecordStatus') return recordStatus(active);
		if (type === 'StartRecord') {
			active = true;
			return undefined;
		}
		if (type === 'StopRecord') {
			active = false;
			return { outputPath: '/Users/demo/Movies/test recording.mkv' };
		}
		throw new Error(`unexpected request ${String(type)}`);
	});

	return { client, connect, call };
}

function useConnection(initiallyActive = false) {
	const stub = createStubClient(initiallyActive);
	const connection = new ObsConnection(
		{ host: '127.0.0.1', port: 4455, password: PASSWORD },
		stub.client
	);
	vi.mocked(getObsConnection).mockReturnValue(connection);
	return stub;
}

vi.mock('./connection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./connection')>();
	return { ...actual, getObsConnection: vi.fn(actual.getObsConnection) };
});

let logs: unknown[][];

beforeEach(() => {
	logs = [];
	const capture = (...args: unknown[]) => void logs.push(args);
	vi.spyOn(console, 'info').mockImplementation(capture);
	vi.spyOn(console, 'warn').mockImplementation(capture);
});

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(getObsConnection).mockReset();
	vi.restoreAllMocks();
	delete (globalThis as { __obsConnection?: ObsConnection }).__obsConnection;
});

describe('getRecordingStatus', () => {
	it('connects and returns OBS recording state, without extra OBS fields', async () => {
		const stub = useConnection();

		const status = await getRecordingStatus();

		expect(stub.connect).toHaveBeenCalledTimes(1);
		expect(stub.call).toHaveBeenCalledWith('GetRecordStatus', undefined);
		expect(status).toEqual({
			active: false,
			paused: false,
			timecode: '00:00:00.000',
			durationMs: 0,
			fileName: null
		});
		expect(status).not.toHaveProperty('outputActive');
		expect(status).not.toHaveProperty('outputBytes');
	});

	it('propagates a connection failure', async () => {
		const stub = useConnection();
		stub.connect.mockRejectedValueOnce(
			new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.')
		);

		await expect(getRecordingStatus()).rejects.toMatchObject({ code: 'OBS_UNAVAILABLE' });
		expect(stub.call).not.toHaveBeenCalled();
	});
});

describe('startRecording', () => {
	it('starts recording after reading OBS state, then confirms the new state', async () => {
		const stub = useConnection();

		const status = await startRecording();

		expect(stub.connect).toHaveBeenCalledTimes(1);
		expect(stub.call.mock.calls.map(([type]) => type)).toEqual([
			'GetRecordStatus',
			'StartRecord',
			'GetRecordStatus'
		]);
		expect(status).toEqual({
			active: true,
			paused: false,
			timecode: '00:00:01.000',
			durationMs: 1000,
			fileName: null
		});
	});

	it('rejects when OBS is already recording, without sending StartRecord', async () => {
		const stub = useConnection(true);

		await expect(startRecording()).rejects.toMatchObject({
			code: 'RECORDING_CONFLICT',
			message: 'OBS is already recording.'
		});
		expect(stub.call.mock.calls.map(([type]) => type)).toEqual(['GetRecordStatus']);
	});

	it('maps OBS OutputRunning (500) to RECORDING_CONFLICT', async () => {
		const stub = useConnection();
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetRecordStatus') return recordStatus(false);
			if (type === 'StartRecord') throw new OBSWebSocketError(500, 'Output running');
			throw new Error(`unexpected request ${String(type)}`);
		});

		await expect(startRecording()).rejects.toMatchObject({ code: 'RECORDING_CONFLICT' });
	});

	it('fails when StartRecord succeeds but OBS stays idle', async () => {
		vi.useFakeTimers();
		const stub = useConnection();
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetRecordStatus') return recordStatus(false);
			if (type === 'StartRecord') return undefined;
			throw new Error(`unexpected request ${String(type)}`);
		});

		const result = expect(startRecording()).rejects.toMatchObject({
			code: 'OBS_REQUEST_FAILED',
			message: 'The recording change is unconfirmed. Check the recording status before retrying.'
		});
		await vi.advanceTimersByTimeAsync(1_000);
		await result;
		expect(
			stub.call.mock.calls.filter(([type]) => type === 'GetRecordStatus').length
		).toBeGreaterThan(1);
	});

	it('does not report success if the connection drops while confirming the new state', async () => {
		const stub = useConnection();
		let statusReads = 0;
		stub.call.mockImplementation((type) => {
			if (type === 'GetRecordStatus') {
				statusReads += 1;
				if (statusReads === 1) return Promise.resolve(recordStatus(false));
				// Same as the library: the in-flight verify call never settles on close.
				return new Promise(() => {});
			}
			if (type === 'StartRecord') return Promise.resolve(undefined);
			return Promise.reject(new Error(`unexpected request ${String(type)}`));
		});

		const pending = startRecording();
		await vi.waitFor(() => expect(statusReads).toBe(2));
		stub.client.emit('ConnectionClosed', new OBSWebSocketError(1006, 'OBS quit'));

		await expect(pending).rejects.toMatchObject({
			code: 'OBS_UNAVAILABLE',
			message: 'Could not connect to OBS.'
		});
	});
});

describe('stopRecording', () => {
	it('stops recording after reading OBS state and returns only the file name', async () => {
		const stub = useConnection(true);

		const status = await stopRecording();

		expect(stub.call.mock.calls.map(([type]) => type)).toEqual([
			'GetRecordStatus',
			'StopRecord',
			'GetRecordStatus'
		]);
		expect(status).toEqual({
			active: false,
			paused: false,
			timecode: '00:00:00.000',
			durationMs: 0,
			fileName: 'test recording.mkv'
		});
		expect(JSON.stringify(status)).not.toContain('/Users/demo');
	});

	it('rejects when OBS is not recording, without sending StopRecord', async () => {
		const stub = useConnection(false);

		await expect(stopRecording()).rejects.toMatchObject({
			code: 'RECORDING_CONFLICT',
			message: 'OBS is not recording.'
		});
		expect(stub.call.mock.calls.map(([type]) => type)).toEqual(['GetRecordStatus']);
	});

	it('maps OBS OutputNotRunning (501) to RECORDING_CONFLICT', async () => {
		const stub = useConnection(true);
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetRecordStatus') return recordStatus(true);
			if (type === 'StopRecord') throw new OBSWebSocketError(501, 'Output not running');
			throw new Error(`unexpected request ${String(type)}`);
		});

		await expect(stopRecording()).rejects.toMatchObject({
			code: 'RECORDING_CONFLICT',
			message: 'OBS is not recording.'
		});
	});

	it('maps an unexpected OBS request error to OBS_REQUEST_FAILED', async () => {
		const stub = useConnection();
		stub.call.mockImplementation(async (type) => {
			if (type === 'GetRecordStatus') return recordStatus(false);
			throw new OBSWebSocketError(702, 'Output not started');
		});

		await expect(startRecording()).rejects.toMatchObject({
			code: 'OBS_REQUEST_FAILED',
			message: 'OBS could not complete the recording request.'
		});
	});

	it('never logs the password or a full output path', async () => {
		useConnection(true);
		await stopRecording();
		useConnection();
		await startRecording();

		expect(logs.length).toBeGreaterThan(0);
		const raw = JSON.stringify(logs);
		expect(raw).not.toContain(PASSWORD);
		expect(raw).not.toContain('env-test-password');
		expect(raw).not.toContain('/Users/demo');
	});
});
