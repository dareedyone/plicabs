import { OBSWebSocketError } from 'obs-websocket-js';
import {
	describeCause,
	getObsConnection,
	ObsConnectionError,
	type ObsConnection
} from './connection';
import { ObsRequestError } from './errors';

/** OBS request status: the named resource does not exist (`ResourceNotFound`). */
const RESOURCE_NOT_FOUND = 600;

/**
 * SetCurrentProgramScene returns before the program scene is guaranteed to
 * change, so we re-read GetCurrentProgramScene until it matches or this budget
 * is used up.
 */
const VERIFY_TIMEOUT_MS = 1_000;
const VERIFY_INTERVAL_MS = 50;

export interface SceneList {
	scenes: string[];
	currentScene: string | null;
}

export async function getScenes(): Promise<SceneList> {
	return readScenes(getObsConnection());
}

export async function switchScene(sceneName: string): Promise<SceneList> {
	const connection = getObsConnection();
	const current = await readScenes(connection);
	if (!current.scenes.includes(sceneName)) {
		throw new ObsRequestError('SCENE_NOT_FOUND', 'That scene was not found.');
	}
	if (current.currentScene === sceneName) {
		throw new ObsRequestError('SCENE_CONFLICT', 'That scene is already active.');
	}

	try {
		await connection.request('SetCurrentProgramScene', { sceneName });
	} catch (cause) {
		throw toSceneError(cause, 'SetCurrentProgramScene');
	}

	await waitUntilCurrent(connection, sceneName);
	console.info(`[obs] Scene switched to ${sceneName}`);
	return { scenes: current.scenes, currentScene: sceneName };
}

async function readScenes(connection: ObsConnection): Promise<SceneList> {
	try {
		const raw = await connection.request('GetSceneList');
		return {
			scenes: sceneNames(raw.scenes),
			currentScene: asSceneName(raw.currentProgramSceneName)
		};
	} catch (cause) {
		throw toSceneError(cause, 'GetSceneList');
	}
}

async function waitUntilCurrent(connection: ObsConnection, sceneName: string): Promise<void> {
	const deadline = Date.now() + VERIFY_TIMEOUT_MS;
	for (;;) {
		let current: string | null;
		try {
			const raw = await connection.request('GetCurrentProgramScene');
			current = asSceneName(raw.sceneName);
		} catch (cause) {
			throw toSceneError(cause, 'GetCurrentProgramScene');
		}
		if (current === sceneName) {
			return;
		}
		if (Date.now() >= deadline) {
			throw new ObsRequestError(
				'OBS_REQUEST_FAILED',
				'The scene change is unconfirmed. Check GET /api/obs/scenes before retrying.'
			);
		}
		await new Promise((resolve) => setTimeout(resolve, VERIFY_INTERVAL_MS));
	}
}

function sceneNames(scenes: unknown): string[] {
	if (!Array.isArray(scenes)) {
		return [];
	}
	const names: string[] = [];
	for (const scene of scenes) {
		if (scene && typeof scene === 'object' && 'sceneName' in scene) {
			const name = asSceneName(scene.sceneName);
			if (name !== null) {
				names.push(name);
			}
		}
	}
	return names;
}

function asSceneName(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function toSceneError(cause: unknown, requestType: string): Error {
	if (cause instanceof ObsConnectionError || cause instanceof ObsRequestError) {
		return cause;
	}
	if (cause instanceof OBSWebSocketError) {
		console.warn(`[obs] ${requestType} failed: ${describeCause(cause)}`);
		if (cause.code === RESOURCE_NOT_FOUND) {
			return new ObsRequestError('SCENE_NOT_FOUND', 'That scene was not found.', { cause });
		}
		return new ObsRequestError('OBS_REQUEST_FAILED', 'OBS could not complete the scene request.', {
			cause
		});
	}
	console.warn(`[obs] ${requestType} failed: ${describeCause(cause)}`);
	return new ObsRequestError('OBS_REQUEST_FAILED', 'OBS could not complete the scene request.', {
		cause
	});
}
