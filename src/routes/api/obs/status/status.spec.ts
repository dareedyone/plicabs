import OBSWebSocket from 'obs-websocket-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getObsConnection,
	type ObsConnection,
	type ObsConnectionStatus
} from '#lib/server/obs/connection.js';
import { GET } from './+server';
import type { RequestEvent } from './$types';

vi.mock('$app/env/private', () => ({
	OBS_HOST: 'obs-host.test',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'test-password'
}));

// The real service by default, so one test can exercise it end to end; the others swap in a fake.
vi.mock('#lib/server/obs/connection.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/server/obs/connection.js')>();
	return { ...actual, getObsConnection: vi.fn(actual.getObsConnection) };
});

/** Makes `getObsConnection()` return a fake with the given status. Returns its `connect` spy. */
function fakeConnection(status: ObsConnectionStatus) {
	const connect = vi.fn();
	vi.mocked(getObsConnection).mockReturnValue({ status, connect } as unknown as ObsConnection);
	return connect;
}

async function requestStatus() {
	const response = await GET({} as RequestEvent);
	return { response, body: await response.json() };
}

afterEach(() => {
	vi.mocked(getObsConnection).mockReset();
	vi.restoreAllMocks();
	delete (globalThis as { __obsConnection?: ObsConnection }).__obsConnection;
});

describe('GET /api/obs/status', () => {
	it('returns 200 JSON when OBS is connected', async () => {
		fakeConnection({ state: 'connected', lastError: null });

		const { response, body } = await requestStatus();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(body).toEqual({ state: 'connected', lastError: null });
	});

	it('reports a connection attempt in progress', async () => {
		fakeConnection({ state: 'connecting', lastError: null });

		const { response, body } = await requestStatus();

		expect(response.status).toBe(200);
		expect(body).toEqual({ state: 'connecting', lastError: null });
	});

	it('returns 200 with no error when OBS has not been contacted yet', async () => {
		fakeConnection({ state: 'disconnected', lastError: null });

		const { response, body } = await requestStatus();

		expect(response.status).toBe(200);
		expect(body).toEqual({ state: 'disconnected', lastError: null });
	});

	it.each(['OBS_UNAVAILABLE', 'OBS_AUTH_FAILED'] as const)(
		'returns 200 with the recorded error %s when disconnected',
		async (lastError) => {
			fakeConnection({ state: 'disconnected', lastError });

			const { response, body } = await requestStatus();

			expect(response.status).toBe(200);
			expect(body).toEqual({ state: 'disconnected', lastError });
		}
	);

	it('returns only the state and error code, even if the service object carries more', async () => {
		const status = {
			state: 'disconnected',
			lastError: 'OBS_AUTH_FAILED',
			password: 'test-password',
			url: 'ws://obs-host.test:4455'
		} as ObsConnectionStatus;
		fakeConnection(status);

		const { body } = await requestStatus();

		expect(body).toEqual({ state: 'disconnected', lastError: 'OBS_AUTH_FAILED' });
	});

	it('does not ask the service to connect', async () => {
		const connect = fakeConnection({ state: 'disconnected', lastError: null });

		await requestStatus();

		expect(connect).not.toHaveBeenCalled();
	});

	it('reads the real shared service without opening a connection or leaking its config', async () => {
		const connect = vi.spyOn(OBSWebSocket.prototype, 'connect');

		const first = await requestStatus();
		const second = await requestStatus();

		expect(first.response.status).toBe(200);
		expect(first.body).toEqual({ state: 'disconnected', lastError: null });
		expect(second.body).toEqual(first.body);
		expect(connect).not.toHaveBeenCalled();
		const raw = JSON.stringify(first.body);
		for (const secret of ['test-password', 'obs-host.test', '4455', 'ws://']) {
			expect(raw).not.toContain(secret);
		}
	});
});
