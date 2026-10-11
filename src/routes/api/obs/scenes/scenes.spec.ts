import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObsConnectionError } from '#lib/server/obs/connection.js';
import { ObsRequestError } from '#lib/server/obs/errors.js';
import { getScenes, switchScene, type SceneList } from '#lib/server/obs/scenes.js';
import { GET } from './+server';
import { POST as switchTo } from './switch/+server';

vi.mock('$app/env/private', () => ({
	OBS_HOST: 'obs-host.test',
	OBS_PORT: 4455,
	OBS_PASSWORD: 'test-password'
}));

vi.mock('#lib/server/obs/scenes.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/server/obs/scenes.js')>();
	return {
		...actual,
		getScenes: vi.fn(),
		switchScene: vi.fn()
	};
});

const listed: SceneList = { scenes: ['Cam', 'Screen'], currentScene: 'Cam' };
const switched: SceneList = { scenes: ['Cam', 'Screen'], currentScene: 'Screen' };

async function invoke(
	handler: (event: never) => Response | Promise<Response>,
	event: Record<string, unknown> = {}
) {
	const response = await handler(event as never);
	return { response, body: await response.json() };
}

function jsonRequest(body: unknown) {
	return { json: async () => body };
}

afterEach(() => {
	vi.mocked(getScenes).mockReset();
	vi.mocked(switchScene).mockReset();
	vi.restoreAllMocks();
});

describe('GET /api/obs/scenes', () => {
	it('returns 200 with the scene list and current program scene', async () => {
		vi.mocked(getScenes).mockResolvedValue(listed);

		const { response, body } = await invoke(GET);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(body).toEqual(listed);
	});

	it('returns 503 when OBS cannot be reached', async () => {
		vi.mocked(getScenes).mockRejectedValue(
			new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.')
		);

		const { response, body } = await invoke(GET);

		expect(response.status).toBe(503);
		expect(body).toEqual({
			error: { code: 'OBS_UNAVAILABLE', message: 'Could not connect to OBS.' }
		});
	});
});

describe('POST /api/obs/scenes/switch', () => {
	it('returns 200 after a successful switch', async () => {
		vi.mocked(switchScene).mockResolvedValue(switched);

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Screen' })
		});

		expect(response.status).toBe(200);
		expect(body).toEqual(switched);
		expect(switchScene).toHaveBeenCalledWith('Screen');
	});

	it('does not trim the requested scene name', async () => {
		vi.mocked(switchScene).mockResolvedValue(listed);

		await invoke(switchTo, { request: jsonRequest({ sceneName: ' Cam' }) });

		expect(switchScene).toHaveBeenCalledWith(' Cam');
	});

	it.each([
		['missing body', undefined],
		['empty object', {}],
		['empty sceneName', { sceneName: '' }],
		['non-string sceneName', { sceneName: 1 }],
		['array body', []],
		['null body', null]
	])('returns 400 for %s', async (_label, body) => {
		const { response, body: json } = await invoke(switchTo, { request: jsonRequest(body) });

		expect(response.status).toBe(400);
		expect(json).toEqual({
			error: {
				code: 'INVALID_REQUEST',
				message: 'Request body must be JSON with a sceneName string.'
			}
		});
		expect(switchScene).not.toHaveBeenCalled();
	});

	it('returns 400 for malformed JSON', async () => {
		const { response, body } = await invoke(switchTo, {
			request: {
				json: async () => {
					throw new SyntaxError('Unexpected token');
				}
			}
		});

		expect(response.status).toBe(400);
		expect(body).toEqual({
			error: {
				code: 'INVALID_REQUEST',
				message: 'Request body must be JSON with a sceneName string.'
			}
		});
		expect(switchScene).not.toHaveBeenCalled();
	});

	it('returns 404 when the scene does not exist', async () => {
		vi.mocked(switchScene).mockRejectedValue(
			new ObsRequestError('SCENE_NOT_FOUND', 'That scene was not found.')
		);

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Missing' })
		});

		expect(response.status).toBe(404);
		expect(body).toEqual({
			error: { code: 'SCENE_NOT_FOUND', message: 'That scene was not found.' }
		});
	});

	it('returns 409 when the scene is already active', async () => {
		vi.mocked(switchScene).mockRejectedValue(
			new ObsRequestError('SCENE_CONFLICT', 'That scene is already active.')
		);

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Cam' })
		});

		expect(response.status).toBe(409);
		expect(body).toEqual({
			error: { code: 'SCENE_CONFLICT', message: 'That scene is already active.' }
		});
	});

	it('returns 502 when the scene change is unconfirmed', async () => {
		vi.mocked(switchScene).mockRejectedValue(
			new ObsRequestError(
				'OBS_REQUEST_FAILED',
				'The scene change is unconfirmed. Check GET /api/obs/scenes before retrying.'
			)
		);

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Screen' })
		});

		expect(response.status).toBe(502);
		expect(body).toEqual({
			error: {
				code: 'OBS_REQUEST_FAILED',
				message: 'The scene change is unconfirmed. Check GET /api/obs/scenes before retrying.'
			}
		});
	});

	it('returns 503 when OBS cannot be reached', async () => {
		vi.mocked(switchScene).mockRejectedValue(
			new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.')
		);

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Screen' })
		});

		expect(response.status).toBe(503);
		expect(body).toEqual({
			error: { code: 'OBS_UNAVAILABLE', message: 'Could not connect to OBS.' }
		});
	});

	it('returns 503 when OBS rejects the password', async () => {
		vi.mocked(switchScene).mockRejectedValue(
			new ObsConnectionError('OBS_AUTH_FAILED', 'OBS rejected the WebSocket password.')
		);

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Screen' })
		});

		expect(response.status).toBe(503);
		expect(body).toEqual({
			error: {
				code: 'OBS_AUTH_FAILED',
				message: 'OBS rejected the WebSocket password.'
			}
		});
		expect(JSON.stringify(body)).not.toContain('test-password');
	});

	it('returns 500 with a safe body for unexpected errors', async () => {
		vi.mocked(switchScene).mockRejectedValue(new Error('socket stack at ws://obs-host.test:4455'));

		const { response, body } = await invoke(switchTo, {
			request: jsonRequest({ sceneName: 'Screen' })
		});

		expect(response.status).toBe(500);
		expect(body).toEqual({
			error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' }
		});
		expect(JSON.stringify(body)).not.toContain('obs-host.test');
		expect(JSON.stringify(body)).not.toContain('4455');
	});
});
