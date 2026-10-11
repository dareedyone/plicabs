import { ObsRequestError } from '#lib/server/obs/errors.js';
import { switchScene } from '#lib/server/obs/scenes.js';
import { obsHandle } from '../../respond.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
	obsHandle(async () => switchScene(await readSceneName(request)));

async function readSceneName(request: Request): Promise<string> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new ObsRequestError(
			'INVALID_REQUEST',
			'Request body must be JSON with a sceneName string.'
		);
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new ObsRequestError(
			'INVALID_REQUEST',
			'Request body must be JSON with a sceneName string.'
		);
	}
	const sceneName = 'sceneName' in body ? body.sceneName : undefined;
	if (typeof sceneName !== 'string' || sceneName === '') {
		throw new ObsRequestError(
			'INVALID_REQUEST',
			'Request body must be JSON with a sceneName string.'
		);
	}
	return sceneName;
}
