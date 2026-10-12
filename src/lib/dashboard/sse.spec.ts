import { describe, expect, it } from 'vitest';
import type { ConnectionStatus, RecordingStatus, SceneList } from './api';
import { applyHubEvent, applySnapshot, parseSseData, type DashboardState } from './sse';

const connected: ConnectionStatus = { state: 'connected', lastError: null };
const disconnected: ConnectionStatus = { state: 'disconnected', lastError: 'OBS_UNAVAILABLE' };
const recording: RecordingStatus = {
	active: true,
	paused: false,
	timecode: '00:00:01.000',
	durationMs: 1000,
	fileName: 'take.mkv'
};
const idle: RecordingStatus = { ...recording, active: false, durationMs: 0, fileName: 'take.mkv' };
const scenes: SceneList = { scenes: ['Cam', 'Screen'], currentScene: 'Cam' };

const empty: DashboardState = { status: null, recording: null, scenes: null };

describe('applySnapshot', () => {
	it('applies a full snapshot', () => {
		expect(applySnapshot(empty, { connection: connected, recording, scenes })).toEqual({
			status: connected,
			recording,
			scenes
		});
	});

	it('keeps previous recording and scenes when the snapshot has nulls', () => {
		const previous = { status: connected, recording, scenes };
		expect(
			applySnapshot(previous, { connection: disconnected, recording: null, scenes: null })
		).toEqual({ status: disconnected, recording, scenes });
	});
});

describe('applyHubEvent', () => {
	it('replaces one field at a time', () => {
		const started = applyHubEvent(empty, 'connection', connected);
		const withRecording = applyHubEvent(started, 'recording', recording);
		const next = applyHubEvent(withRecording, 'scenes', scenes);
		expect(next).toEqual({ status: connected, recording, scenes });
	});

	it('applies the same recording payload twice without changing meaning', () => {
		const once = applyHubEvent(empty, 'recording', idle);
		expect(applyHubEvent(once, 'recording', idle)).toEqual(once);
	});

	it('ignores unknown event types and malformed data', () => {
		expect(applyHubEvent(empty, 'nope', { foo: 1 })).toEqual(empty);
		expect(applyHubEvent(empty, 'recording', 'x')).toEqual(empty);
	});
});

describe('parseSseData', () => {
	it('parses JSON and rejects invalid payloads', () => {
		expect(parseSseData<ConnectionStatus>('{"state":"connected","lastError":null}')).toEqual(
			connected
		);
		expect(parseSseData('not-json')).toBeNull();
	});
});
