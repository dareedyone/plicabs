export type ConnectionState = 'disconnected' | 'connecting' | 'connected';
export type ConnectionErrorCode = 'OBS_UNAVAILABLE' | 'OBS_AUTH_FAILED';

export interface ConnectionStatus {
	state: ConnectionState;
	lastError: ConnectionErrorCode | null;
}

export interface RecordingStatus {
	active: boolean;
	paused: boolean;
	timecode: string;
	durationMs: number;
	fileName: string | null;
}

export interface SceneList {
	scenes: string[];
	currentScene: string | null;
}

export class ApiError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
	}
}

export function messageOf(error: unknown): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return 'Something went wrong.';
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
	return request('/api/obs/status', { method: 'GET' }, parseConnectionStatus);
}

export async function getRecordingStatus(): Promise<RecordingStatus> {
	return request('/api/obs/recording', { method: 'GET' }, parseRecordingStatus);
}

export async function startRecording(): Promise<RecordingStatus> {
	return request('/api/obs/recording/start', jsonPost({}), parseRecordingStatus);
}

export async function stopRecording(): Promise<RecordingStatus> {
	return request('/api/obs/recording/stop', jsonPost({}), parseRecordingStatus);
}

export async function getScenes(): Promise<SceneList> {
	return request('/api/obs/scenes', { method: 'GET' }, parseSceneList);
}

export async function switchScene(sceneName: string): Promise<SceneList> {
	return request('/api/obs/scenes/switch', jsonPost({ sceneName }), parseSceneList);
}

function jsonPost(body: unknown): RequestInit {
	return {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	};
}

async function request<T>(url: string, init: RequestInit, parse: (body: unknown) => T): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url, init);
	} catch {
		throw new ApiError(
			'NETWORK_ERROR',
			'Could not reach the app server. Check that it is running.',
			0
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new ApiError(
			'INVALID_RESPONSE',
			'The app returned an unexpected response.',
			response.status
		);
	}

	if (!response.ok) {
		const error = errorFrom(body);
		throw new ApiError(error.code, error.message, response.status);
	}

	try {
		return parse(body);
	} catch {
		throw new ApiError(
			'INVALID_RESPONSE',
			'The app returned an unexpected response.',
			response.status
		);
	}
}

function errorFrom(body: unknown): { code: string; message: string } {
	if (body && typeof body === 'object' && 'error' in body) {
		const error = body.error;
		if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
			const code = error.code;
			const message = error.message;
			if (typeof code === 'string' && typeof message === 'string' && message) {
				return { code, message };
			}
		}
	}
	return { code: 'INVALID_RESPONSE', message: 'The app returned an unexpected response.' };
}

function parseConnectionStatus(body: unknown): ConnectionStatus {
	if (!body || typeof body !== 'object') {
		throw new Error('invalid');
	}
	const { state, lastError } = body as { state?: unknown; lastError?: unknown };
	if (state !== 'disconnected' && state !== 'connecting' && state !== 'connected') {
		throw new Error('invalid');
	}
	if (lastError !== null && lastError !== 'OBS_UNAVAILABLE' && lastError !== 'OBS_AUTH_FAILED') {
		throw new Error('invalid');
	}
	return { state, lastError };
}

function parseRecordingStatus(body: unknown): RecordingStatus {
	if (!body || typeof body !== 'object') {
		throw new Error('invalid');
	}
	const raw = body as Record<string, unknown>;
	if (typeof raw.active !== 'boolean') {
		throw new Error('invalid');
	}
	return {
		active: raw.active,
		paused: typeof raw.paused === 'boolean' ? raw.paused : false,
		timecode: typeof raw.timecode === 'string' ? raw.timecode : '00:00:00.000',
		durationMs:
			typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) ? raw.durationMs : 0,
		fileName: typeof raw.fileName === 'string' && raw.fileName ? raw.fileName : null
	};
}

function parseSceneList(body: unknown): SceneList {
	if (!body || typeof body !== 'object') {
		throw new Error('invalid');
	}
	const raw = body as Record<string, unknown>;
	const scenes = Array.isArray(raw.scenes)
		? raw.scenes.filter((name): name is string => typeof name === 'string')
		: [];
	const currentScene = typeof raw.currentScene === 'string' ? raw.currentScene : null;
	return { scenes, currentScene };
}

export function connectionErrorMessage(lastError: ConnectionErrorCode | null): string | null {
	if (lastError === 'OBS_AUTH_FAILED') {
		return 'OBS rejected the WebSocket password.';
	}
	if (lastError === 'OBS_UNAVAILABLE') {
		return 'Could not connect to OBS.';
	}
	return null;
}
