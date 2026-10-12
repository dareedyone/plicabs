import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ApiError,
	connectionErrorMessage,
	getConnectionStatus,
	getRecordingStatus,
	getScenes,
	messageOf,
	startRecording,
	stopRecording,
	switchScene
} from './api';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('getConnectionStatus', () => {
	it('returns the connection status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(200, { state: 'connected', lastError: null }))
		);

		await expect(getConnectionStatus()).resolves.toEqual({
			state: 'connected',
			lastError: null
		});
		expect(fetch).toHaveBeenCalledWith('/api/obs/status', { method: 'GET' });
	});

	it('rejects a malformed status payload', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { state: 'up' })));

		await expect(getConnectionStatus()).rejects.toMatchObject({
			code: 'INVALID_RESPONSE'
		});
	});
});

describe('recording API', () => {
	const recording = {
		active: true,
		paused: false,
		timecode: '00:00:01.000',
		durationMs: 1000,
		fileName: null
	};

	it('loads recording status', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, recording)));

		await expect(getRecordingStatus()).resolves.toEqual(recording);
		expect(fetch).toHaveBeenCalledWith('/api/obs/recording', { method: 'GET' });
	});

	it('starts recording with a JSON content type', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, recording)));

		await expect(startRecording()).resolves.toEqual(recording);
		expect(fetch).toHaveBeenCalledWith('/api/obs/recording/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}'
		});
	});

	it('stops recording and keeps a filename from the response', async () => {
		const stopped = { ...recording, active: false, fileName: 'clip.mkv', durationMs: 0 };
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, stopped)));

		await expect(stopRecording()).resolves.toEqual(stopped);
	});

	it('surfaces a recording conflict from the API envelope', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				jsonResponse(409, {
					error: { code: 'RECORDING_CONFLICT', message: 'OBS is already recording.' }
				})
			)
		);

		const error = await startRecording().catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			code: 'RECORDING_CONFLICT',
			message: 'OBS is already recording.',
			status: 409
		});
	});

	it('does not treat an empty filename as a real name', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(jsonResponse(200, { ...recording, fileName: '' }))
		);

		await expect(getRecordingStatus()).resolves.toMatchObject({ fileName: null });
	});
});

describe('scene API', () => {
	it('loads scenes and drops non-string entries', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(jsonResponse(200, { scenes: ['Cam', 1, 'Screen'], currentScene: 'Cam' }))
		);

		await expect(getScenes()).resolves.toEqual({
			scenes: ['Cam', 'Screen'],
			currentScene: 'Cam'
		});
	});

	it('switches scene with the requested name', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(jsonResponse(200, { scenes: ['Cam', 'Screen'], currentScene: 'Screen' }))
		);

		await expect(switchScene('Screen')).resolves.toEqual({
			scenes: ['Cam', 'Screen'],
			currentScene: 'Screen'
		});
		expect(fetch).toHaveBeenCalledWith('/api/obs/scenes/switch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sceneName: 'Screen' })
		});
	});

	it('surfaces an unknown scene as a useful error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				jsonResponse(404, {
					error: { code: 'SCENE_NOT_FOUND', message: 'That scene was not found.' }
				})
			)
		);

		await expect(switchScene('Missing')).rejects.toMatchObject({
			code: 'SCENE_NOT_FOUND',
			message: 'That scene was not found.',
			status: 404
		});
	});
});

describe('request failures', () => {
	it('maps a network failure to a safe message', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

		await expect(getScenes()).rejects.toMatchObject({
			code: 'NETWORK_ERROR',
			message: 'Could not reach the app server. Check that it is running.'
		});
	});

	it('maps non-JSON error bodies to a fallback message', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));

		await expect(getRecordingStatus()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
	});

	it('messageOf prefers the API error text', () => {
		expect(messageOf(new ApiError('OBS_UNAVAILABLE', 'Could not connect to OBS.', 503))).toBe(
			'Could not connect to OBS.'
		);
		expect(messageOf(new Error('boom'))).toBe('boom');
		expect(messageOf('x')).toBe('Something went wrong.');
	});

	it('connectionErrorMessage maps known lastError codes', () => {
		expect(connectionErrorMessage('OBS_UNAVAILABLE')).toBe('Could not connect to OBS.');
		expect(connectionErrorMessage('OBS_AUTH_FAILED')).toBe('OBS rejected the WebSocket password.');
		expect(connectionErrorMessage(null)).toBeNull();
	});
});
