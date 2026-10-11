import OBSWebSocket, { EventSubscription, OBSWebSocketError } from 'obs-websocket-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObsConfig } from './config';
import { getObsConnection, ObsConnection, ObsConnectionError } from './connection';

vi.mock('$app/env/private', () => ({
	OBS_HOST: '127.0.0.1',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'env-test-password'
}));

const PASSWORD = 'test-password';
const config: ObsConfig = { host: '127.0.0.1', port: 4455, password: PASSWORD };

type ConnectResult = Awaited<ReturnType<OBSWebSocket['connect']>>;
const connectResult = { obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 } as ConnectResult;

/**
 * A real OBSWebSocket (so events and error types are genuine) with its network methods stubbed.
 * By default `connect` succeeds; tests override it with `mockImplementationOnce`.
 */
function createStubClient() {
	const client = new OBSWebSocket();
	let identified = false;

	vi.spyOn(client, 'identified', 'get').mockImplementation(() => identified);

	/** Mirrors obs-websocket-js: `ConnectionClosed` is emitted before `identified` is reset. */
	function closeSocket(code: number, reason = '') {
		client.emit('ConnectionClosed', new OBSWebSocketError(code, reason));
		identified = false;
	}

	const connect = vi.spyOn(client, 'connect').mockImplementation(async () => {
		identified = true;
		return connectResult;
	});
	const disconnect = vi.spyOn(client, 'disconnect').mockImplementation(async () => {
		if (identified) closeSocket(1000);
	});

	return { client, connect, disconnect, closeSocket };
}

type StubClient = ReturnType<typeof createStubClient>;

/** Rejects the way obs-websocket-js does when OBS closes the socket: close event, then rejection. */
function failWith(stub: StubClient, code: number, reason: string) {
	return async (): Promise<ConnectResult> => {
		stub.closeSocket(code, reason);
		throw new OBSWebSocketError(code, reason);
	};
}

/** As in Node: the socket errors and closes with 1006, and `connect()` rejects with the error. */
function refuse(stub: StubClient) {
	return async (): Promise<ConnectResult> => {
		stub.closeSocket(1006);
		throw new OBSWebSocketError(-1, 'connect ECONNREFUSED 127.0.0.1:4455');
	};
}

/**
 * An attempt that never completes on its own. As in obs-websocket-js, `disconnect()` closes the
 * socket (once `closing` resolves) and only then does the attempt reject.
 */
function hangUntilDisconnected(stub: StubClient, closing: Promise<void> = Promise.resolve()) {
	return () =>
		new Promise<ConnectResult>((_, reject) => {
			stub.disconnect.mockImplementationOnce(async () => {
				await closing;
				stub.closeSocket(1006);
				reject(new OBSWebSocketError(1006, ''));
			});
		});
}

let logs: unknown[][];

beforeEach(() => {
	logs = [];
	const capture = (...args: unknown[]) => void logs.push(args);
	vi.spyOn(console, 'info').mockImplementation(capture);
	vi.spyOn(console, 'warn').mockImplementation(capture);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('ObsConnection', () => {
	it('does not connect until connect() is called', () => {
		const stub = createStubClient();
		const connection = new ObsConnection(config, stub.client);

		expect(stub.connect).not.toHaveBeenCalled();
		expect(connection.isConnected()).toBe(false);
		expect(connection.status).toEqual({ state: 'disconnected', lastError: null });
	});

	it('connects with the configured URL and password and no event subscriptions', async () => {
		const stub = createStubClient();
		const connection = new ObsConnection(config, stub.client);

		await connection.connect();

		expect(stub.connect).toHaveBeenCalledWith('ws://127.0.0.1:4455', PASSWORD, {
			eventSubscriptions: EventSubscription.None
		});
		expect(connection.isConnected()).toBe(true);
		expect(connection.status).toEqual({ state: 'connected', lastError: null });
	});

	it('connects without a password when none is configured', async () => {
		const stub = createStubClient();
		const connection = new ObsConnection({ ...config, password: undefined }, stub.client);

		await connection.connect();

		expect(stub.connect).toHaveBeenCalledWith('ws://127.0.0.1:4455', undefined, {
			eventSubscriptions: EventSubscription.None
		});
	});

	it('reuses an active connection', async () => {
		const stub = createStubClient();
		const connection = new ObsConnection(config, stub.client);

		await connection.connect();
		await connection.connect();

		expect(stub.connect).toHaveBeenCalledTimes(1);
	});

	it('shares one attempt between concurrent callers', async () => {
		const stub = createStubClient();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const succeed = stub.connect.getMockImplementation()!;
		stub.connect.mockImplementationOnce(async (...args) => {
			await gate;
			return succeed(...args);
		});
		const connection = new ObsConnection(config, stub.client);

		const first = connection.connect();
		const second = connection.connect();
		expect(connection.status.state).toBe('connecting');

		release();
		await Promise.all([first, second]);

		expect(stub.connect).toHaveBeenCalledTimes(1);
		expect(connection.status.state).toBe('connected');
	});

	it('reports OBS as unavailable when it cannot be reached', async () => {
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(refuse(stub));
		const connection = new ObsConnection(config, stub.client);

		const error = await connection.connect().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ObsConnectionError);
		expect(error).toMatchObject({ code: 'OBS_UNAVAILABLE', message: 'Could not connect to OBS.' });
		expect(connection.status).toEqual({ state: 'disconnected', lastError: 'OBS_UNAVAILABLE' });
	});

	it('reports an authentication failure when OBS closes with code 4009', async () => {
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(failWith(stub, 4009, 'Authentication failed.'));
		const connection = new ObsConnection(config, stub.client);

		await expect(connection.connect()).rejects.toMatchObject({
			code: 'OBS_AUTH_FAILED',
			message: 'OBS rejected the WebSocket password.'
		});
		expect(connection.status).toEqual({ state: 'disconnected', lastError: 'OBS_AUTH_FAILED' });
	});

	it('logs one warning per failed attempt, not one per socket event', async () => {
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(failWith(stub, 1006, ''));
		const connection = new ObsConnection(config, stub.client);

		await connection.connect().catch(() => {});

		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledWith(
			'[obs] Could not connect to ws://127.0.0.1:4455: code 1006'
		);
	});

	it('rejects every concurrent caller of a failed attempt with the same error', async () => {
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(failWith(stub, 1006, ''));
		const connection = new ObsConnection(config, stub.client);

		const results = await Promise.allSettled([connection.connect(), connection.connect()]);

		expect(stub.connect).toHaveBeenCalledTimes(1);
		expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
		const [first, second] = results as PromiseRejectedResult[];
		expect(first.reason).toBe(second.reason);
	});

	it('tries again on the next call after a failure', async () => {
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(refuse(stub));
		const connection = new ObsConnection(config, stub.client);

		await expect(connection.connect()).rejects.toBeInstanceOf(ObsConnectionError);
		await connection.connect();

		expect(stub.connect).toHaveBeenCalledTimes(2);
		expect(connection.status).toEqual({ state: 'connected', lastError: null });
	});

	it('times out an attempt that never completes and closes its socket', async () => {
		vi.useFakeTimers();
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(hangUntilDisconnected(stub));
		const connection = new ObsConnection(config, stub.client);

		const result = expect(connection.connect()).rejects.toMatchObject({
			code: 'OBS_UNAVAILABLE',
			message: 'Timed out connecting to OBS.'
		});
		await vi.advanceTimersByTimeAsync(5_000);
		await result;

		expect(stub.disconnect).toHaveBeenCalledTimes(1);
		expect(connection.status).toEqual({ state: 'disconnected', lastError: 'OBS_UNAVAILABLE' });
		expect(console.warn).toHaveBeenCalledTimes(1);
	});

	it('does not open a second socket while a timed-out attempt is still closing', async () => {
		vi.useFakeTimers();
		const stub = createStubClient();
		let finishClosing!: () => void;
		const closing = new Promise<void>((resolve) => (finishClosing = resolve));
		stub.connect.mockImplementationOnce(hangUntilDisconnected(stub, closing));
		const connection = new ObsConnection(config, stub.client);

		const timedOut = expect(connection.connect()).rejects.toMatchObject({
			message: 'Timed out connecting to OBS.'
		});
		await vi.advanceTimersByTimeAsync(5_000);
		await timedOut;

		await expect(connection.connect()).rejects.toMatchObject({ code: 'OBS_UNAVAILABLE' });
		expect(stub.connect).toHaveBeenCalledTimes(1);

		finishClosing();
		await vi.waitFor(() => connection.connect());

		expect(stub.connect).toHaveBeenCalledTimes(2);
		expect(connection.status).toEqual({ state: 'connected', lastError: null });
	});

	it('does not report a timed-out attempt as connected if it completes late', async () => {
		vi.useFakeTimers();
		const stub = createStubClient();
		let completeLate!: () => void;
		const succeed = stub.connect.getMockImplementation()!;
		stub.connect.mockImplementationOnce(
			(...args) =>
				new Promise<ConnectResult>((resolve) => {
					completeLate = () => resolve(succeed(...args));
				})
		);
		const connection = new ObsConnection(config, stub.client);

		const timedOut = connection.connect().catch(() => {});
		await vi.advanceTimersByTimeAsync(5_000);
		await timedOut;
		completeLate();
		await vi.advanceTimersByTimeAsync(0);

		expect(stub.client.identified).toBe(true);
		expect(connection.isConnected()).toBe(false);
		expect(connection.status.state).toBe('disconnected');
	});

	it('marks itself disconnected when OBS closes the connection, then reconnects on demand', async () => {
		const stub = createStubClient();
		const connection = new ObsConnection(config, stub.client);
		await connection.connect();

		stub.closeSocket(1006, 'OBS quit');

		expect(connection.status).toEqual({ state: 'disconnected', lastError: 'OBS_UNAVAILABLE' });

		await connection.connect();
		expect(stub.connect).toHaveBeenCalledTimes(2);
		expect(connection.status).toEqual({ state: 'connected', lastError: null });
	});

	it('clears the error after a deliberate disconnect', async () => {
		const stub = createStubClient();
		const connection = new ObsConnection(config, stub.client);
		await connection.connect();

		await connection.disconnect();

		expect(stub.disconnect).toHaveBeenCalledTimes(1);
		expect(connection.status).toEqual({ state: 'disconnected', lastError: null });
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('never logs the password', async () => {
		const stub = createStubClient();
		stub.connect.mockImplementationOnce(failWith(stub, 4009, 'Authentication failed.'));
		const connection = new ObsConnection(config, stub.client);

		await connection.connect().catch(() => {});
		await connection.connect();
		stub.closeSocket(1006);

		expect(logs.length).toBeGreaterThan(0);
		expect(JSON.stringify(logs)).not.toContain(PASSWORD);
	});

	it('request() connects then forwards the OBS request', async () => {
		const stub = createStubClient();
		const call = vi.spyOn(stub.client, 'call').mockResolvedValue({
			outputActive: false,
			outputPaused: false,
			outputTimecode: '00:00:00.000',
			outputDuration: 0,
			outputBytes: 0
		});
		const connection = new ObsConnection(config, stub.client);

		const result = await connection.request('GetRecordStatus');

		expect(stub.connect).toHaveBeenCalledTimes(1);
		expect(call).toHaveBeenCalledWith('GetRecordStatus', undefined);
		expect(result.outputActive).toBe(false);

		await connection.request('GetRecordStatus');
		expect(stub.connect).toHaveBeenCalledTimes(1);
	});

	it('request() does not send an OBS request when connect fails', async () => {
		const stub = createStubClient();
		const call = vi.spyOn(stub.client, 'call');
		stub.connect.mockImplementationOnce(failWith(stub, 4009, 'Authentication failed.'));
		const connection = new ObsConnection(config, stub.client);

		await expect(connection.request('GetRecordStatus')).rejects.toMatchObject({
			code: 'OBS_AUTH_FAILED'
		});
		expect(call).not.toHaveBeenCalled();
	});

	it('request() rethrows an OBS request error while the session is still up', async () => {
		const stub = createStubClient();
		vi.spyOn(stub.client, 'call').mockRejectedValueOnce(
			new OBSWebSocketError(500, 'Output running')
		);
		const connection = new ObsConnection(config, stub.client);

		const error = await connection.request('StartRecord').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(OBSWebSocketError);
		expect(error).toMatchObject({ code: 500 });
		expect(connection.isConnected()).toBe(true);
	});

	it('request() treats a drop during an in-flight call as OBS_UNAVAILABLE', async () => {
		const stub = createStubClient();
		// Real obs-websocket-js: call() waits for res:<id> and never rejects on close.
		// onClose emits ConnectionClosed, then cleanup() orphans that waiter.
		const call = vi.spyOn(stub.client, 'call').mockImplementationOnce(() => new Promise(() => {}));
		const connection = new ObsConnection(config, stub.client);

		const pending = connection.request('GetRecordStatus');
		await vi.waitFor(() => expect(call).toHaveBeenCalled());
		stub.closeSocket(1006, 'OBS quit');

		await expect(pending).rejects.toMatchObject({
			code: 'OBS_UNAVAILABLE',
			message: 'Could not connect to OBS.'
		});
		expect(connection.isConnected()).toBe(false);
	});

	it('request() maps an in-flight close 4009 to OBS_AUTH_FAILED', async () => {
		const stub = createStubClient();
		const call = vi.spyOn(stub.client, 'call').mockImplementationOnce(() => new Promise(() => {}));
		const connection = new ObsConnection(config, stub.client);

		const pending = connection.request('GetRecordStatus');
		await vi.waitFor(() => expect(call).toHaveBeenCalled());
		stub.closeSocket(4009, 'Authentication failed.');

		await expect(pending).rejects.toMatchObject({
			code: 'OBS_AUTH_FAILED',
			message: 'OBS rejected the WebSocket password.'
		});
	});

	it('request() still classifies a close by its code if the session looks connected', async () => {
		const stub = createStubClient();
		const call = vi.spyOn(stub.client, 'call').mockImplementationOnce(() => new Promise(() => {}));
		const connection = new ObsConnection(config, stub.client);

		const pending = connection.request('GetRecordStatus');
		await vi.waitFor(() => expect(call).toHaveBeenCalled());
		vi.spyOn(connection, 'isConnected').mockReturnValue(true);
		stub.closeSocket(4009, 'Authentication failed.');

		const error = await pending.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ObsConnectionError);
		expect(error).toMatchObject({ code: 'OBS_AUTH_FAILED' });
		expect(error).not.toBeInstanceOf(OBSWebSocketError);
	});
});

describe('getObsConnection', () => {
	afterEach(() => {
		delete (globalThis as { __obsConnection?: ObsConnection }).__obsConnection;
	});

	it('returns one shared instance and does not connect', () => {
		const connect = vi.spyOn(OBSWebSocket.prototype, 'connect');

		const connection = getObsConnection();

		expect(getObsConnection()).toBe(connection);
		expect(connection.status).toEqual({ state: 'disconnected', lastError: null });
		expect(connect).not.toHaveBeenCalled();
	});

	it('connects using the values from $app/env/private', async () => {
		const connect = vi
			.spyOn(OBSWebSocket.prototype, 'connect')
			.mockRejectedValue(new OBSWebSocketError(-1, 'connect ECONNREFUSED'));

		await getObsConnection()
			.connect()
			.catch(() => {});

		expect(connect).toHaveBeenCalledWith('ws://127.0.0.1:4455', 'env-test-password', {
			eventSubscriptions: EventSubscription.None
		});
	});
});
