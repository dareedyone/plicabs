import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObsConnectionError } from '#lib/server/obs/connection.js';
import {
	getRecordingStatus,
	ObsRequestError,
	startRecording,
	stopRecording,
	type RecordingStatus
} from '#lib/server/obs/recording.js';
import { GET } from './+server';
import { POST as start } from './start/+server';
import { POST as stop } from './stop/+server';

vi.mock('$app/env/private', () => ({
	OBS_HOST: 'obs-host.test',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'test-password'
}));

vi.mock('#lib/server/obs/recording.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/server/obs/recording.js')>();
	return {
		...actual,
		getRecordingStatus: vi.fn(),
		startRecording: vi.fn(),
		stopRecording: vi.fn()
	};
});

const idle: RecordingStatus = {
	active: false,
	paused: false,
	timecode: '00:00:00.000',
	durationMs: 0,
	fileName: null
};

const recording: RecordingStatus = {
	active: true,
	paused: false,
	timecode: '00:00:01.000',
	durationMs: 1000,
	fileName: null
};

async function invoke(handler: (event: never) => Response | Promise<Response>) {
	const response = await handler({} as never);
	return { response, body: await response.json() };
}

afterEach(() => {
	vi.mocked(getRecordingStatus).mockReset();
	vi.mocked(startRecording).mockReset();
	vi.mocked(stopRecording).mockReset();
	vi.restoreAllMocks();
});

describe('GET /api/obs/recording', () => {
	it('returns 200 with OBS recording state', async () => {
		vi.mocked(getRecordingStatus).mockResolvedValue(recording);

		const { response, body } = await invoke(GET);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(body).toEqual(recording);
	});

	it('returns 503 when OBS cannot be reached', async () => {
		vi.mocked(getRecordingStatus).mockRejectedValue(
			new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.')
		);

		const { response, body } = await invoke(GET);

		expect(response.status).toBe(503);
		expect(body).toEqual({
			error: { code: 'OBS_UNAVAILABLE', message: 'Could not connect to OBS.' }
		});
	});
});

describe('POST /api/obs/recording/start', () => {
	it('returns 200 after a successful start', async () => {
		vi.mocked(startRecording).mockResolvedValue(recording);

		const { response, body } = await invoke(start);

		expect(response.status).toBe(200);
		expect(body).toEqual(recording);
	});

	it('returns 409 when OBS is already recording', async () => {
		vi.mocked(startRecording).mockRejectedValue(
			new ObsRequestError('RECORDING_CONFLICT', 'OBS is already recording.')
		);

		const { response, body } = await invoke(start);

		expect(response.status).toBe(409);
		expect(body).toEqual({
			error: { code: 'RECORDING_CONFLICT', message: 'OBS is already recording.' }
		});
	});

	it('returns 503 when OBS rejects the password', async () => {
		vi.mocked(startRecording).mockRejectedValue(
			new ObsConnectionError('OBS_AUTH_FAILED', 'OBS rejected the WebSocket password.')
		);

		const { response, body } = await invoke(start);

		expect(response.status).toBe(503);
		expect(body).toEqual({
			error: {
				code: 'OBS_AUTH_FAILED',
				message: 'OBS rejected the WebSocket password.'
			}
		});
	});

	it('returns 502 when the recording change is unconfirmed', async () => {
		vi.mocked(startRecording).mockRejectedValue(
			new ObsRequestError(
				'OBS_REQUEST_FAILED',
				'The recording change is unconfirmed. Check the recording status before retrying.'
			)
		);

		const { response, body } = await invoke(start);

		expect(response.status).toBe(502);
		expect(body).toEqual({
			error: {
				code: 'OBS_REQUEST_FAILED',
				message: 'The recording change is unconfirmed. Check the recording status before retrying.'
			}
		});
	});

	it('returns 503 when the connection drops after the command is sent', async () => {
		vi.mocked(startRecording).mockRejectedValue(
			new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.')
		);

		const { response, body } = await invoke(start);

		expect(response.status).toBe(503);
		expect(body).toEqual({
			error: { code: 'OBS_UNAVAILABLE', message: 'Could not connect to OBS.' }
		});
		expect(JSON.stringify(body)).not.toContain('test-password');
	});
});

describe('POST /api/obs/recording/stop', () => {
	it('returns 200 with the saved file name', async () => {
		vi.mocked(stopRecording).mockResolvedValue({ ...idle, fileName: 'clip.mkv' });

		const { response, body } = await invoke(stop);

		expect(response.status).toBe(200);
		expect(body).toEqual({ ...idle, fileName: 'clip.mkv' });
	});

	it('returns 409 when OBS is not recording', async () => {
		vi.mocked(stopRecording).mockRejectedValue(
			new ObsRequestError('RECORDING_CONFLICT', 'OBS is not recording.')
		);

		const { response, body } = await invoke(stop);

		expect(response.status).toBe(409);
		expect(body).toEqual({
			error: { code: 'RECORDING_CONFLICT', message: 'OBS is not recording.' }
		});
	});

	it('returns 500 with a safe body for unexpected errors', async () => {
		vi.mocked(stopRecording).mockRejectedValue(
			new Error('socket stack at ws://obs-host.test:4455')
		);

		const { response, body } = await invoke(stop);

		expect(response.status).toBe(500);
		expect(body).toEqual({
			error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' }
		});
		expect(JSON.stringify(body)).not.toContain('obs-host.test');
		expect(JSON.stringify(body)).not.toContain('4455');
	});
});
