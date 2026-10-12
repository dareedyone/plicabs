import type { RecordingStatus, SceneList } from './api';

export function recordingButtons(
	recording: RecordingStatus | null,
	loading: boolean,
	busy: 'start' | 'stop' | null
): { startDisabled: boolean; stopDisabled: boolean } {
	if (!recording || loading || busy !== null) {
		return { startDisabled: true, stopDisabled: true };
	}
	return {
		startDisabled: recording.active,
		stopDisabled: !recording.active
	};
}

export function canSwitchTo(scenes: SceneList | null, sceneName: string, busy: boolean): boolean {
	if (busy || !scenes) {
		return false;
	}
	return scenes.scenes.includes(sceneName) && scenes.currentScene !== sceneName;
}
