import type { ConnectionStatus, RecordingStatus, SceneList } from './api';

export interface DashboardSnapshot {
	connection: ConnectionStatus;
	recording: RecordingStatus | null;
	scenes: SceneList | null;
}

export interface DashboardState {
	status: ConnectionStatus | null;
	recording: RecordingStatus | null;
	scenes: SceneList | null;
}

/** Replace known fields; keep the previous recording/scenes when a snapshot omits them. */
export function applySnapshot(state: DashboardState, snapshot: DashboardSnapshot): DashboardState {
	return {
		status: snapshot.connection,
		recording: snapshot.recording ?? state.recording,
		scenes: snapshot.scenes ?? state.scenes
	};
}

export function applyHubEvent(state: DashboardState, type: string, data: unknown): DashboardState {
	if (type === 'connection' && isConnection(data)) {
		return { ...state, status: data };
	}
	if (type === 'recording' && isRecording(data)) {
		return { ...state, recording: data };
	}
	if (type === 'scenes' && isScenes(data)) {
		return { ...state, scenes: data };
	}
	return state;
}

function isConnection(data: unknown): data is ConnectionStatus {
	if (!data || typeof data !== 'object') {
		return false;
	}
	const state = (data as ConnectionStatus).state;
	return state === 'connected' || state === 'connecting' || state === 'disconnected';
}

function isRecording(data: unknown): data is RecordingStatus {
	return Boolean(
		data && typeof data === 'object' && typeof (data as RecordingStatus).active === 'boolean'
	);
}

function isScenes(data: unknown): data is SceneList {
	return Boolean(data && typeof data === 'object' && Array.isArray((data as SceneList).scenes));
}

export function parseSseData<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}
