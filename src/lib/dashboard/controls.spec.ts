import { describe, expect, it } from 'vitest';
import { canSwitchTo, recordingButtons } from './controls';
import type { RecordingStatus, SceneList } from './api';

const idle: RecordingStatus = {
	active: false,
	paused: false,
	timecode: '00:00:00.000',
	durationMs: 0,
	fileName: null
};

const live: RecordingStatus = { ...idle, active: true, durationMs: 1000 };

const scenes: SceneList = { scenes: ['Cam', 'Screen'], currentScene: 'Cam' };

describe('recordingButtons', () => {
	it('enables start only when idle and not busy', () => {
		expect(recordingButtons(idle, false, null)).toEqual({
			startDisabled: false,
			stopDisabled: true
		});
	});

	it('enables stop only while recording', () => {
		expect(recordingButtons(live, false, null)).toEqual({
			startDisabled: true,
			stopDisabled: false
		});
	});

	it('disables both while loading, busy, or before the first status arrives', () => {
		expect(recordingButtons(idle, true, null).startDisabled).toBe(true);
		expect(recordingButtons(live, false, 'start').stopDisabled).toBe(true);
		expect(recordingButtons(null, false, null)).toEqual({
			startDisabled: true,
			stopDisabled: true
		});
	});
});

describe('canSwitchTo', () => {
	it('allows a different loaded scene', () => {
		expect(canSwitchTo(scenes, 'Screen', false)).toBe(true);
	});

	it('blocks the current scene, empty lists, and in-flight switches', () => {
		expect(canSwitchTo(scenes, 'Cam', false)).toBe(false);
		expect(canSwitchTo(scenes, 'Screen', true)).toBe(false);
		expect(canSwitchTo({ scenes: [], currentScene: null }, 'Cam', false)).toBe(false);
		expect(canSwitchTo(null, 'Cam', false)).toBe(false);
	});
});
