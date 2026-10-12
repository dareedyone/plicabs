import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import {
	ApiError,
	startRecording,
	stopRecording,
	type RecordingStatus
} from '#lib/dashboard/api.js';
import RecordingPanel from './RecordingPanel.svelte';

vi.mock('#lib/dashboard/api.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/dashboard/api.js')>();
	return { ...actual, startRecording: vi.fn(), stopRecording: vi.fn() };
});

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(startRecording).mockReset();
	vi.mocked(stopRecording).mockReset();
});

const idle: RecordingStatus = {
	active: false,
	paused: false,
	timecode: '00:00:00.000',
	durationMs: 0,
	fileName: null
};

const live: RecordingStatus = {
	...idle,
	active: true,
	durationMs: 5_000
};

function renderPanel(
	overrides: Partial<{
		recording: RecordingStatus | null;
		loading: boolean;
		error: string | null;
	}> = {}
) {
	const onrecording = vi.fn();
	const onaction = vi.fn();
	const view = render(RecordingPanel, {
		props: {
			recording: null,
			loading: false,
			error: null,
			onrecording,
			onaction,
			...overrides
		}
	});
	return { ...view, onrecording, onaction };
}

describe('RecordingPanel', () => {
	it('shows a loading message before the first recording status arrives', () => {
		renderPanel({ loading: true, recording: null });

		expect(screen.getByText('Loading status')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Start Recording' })).toHaveProperty(
			'disabled',
			true
		);
		expect(screen.getByRole('button', { name: 'Stop Recording' })).toHaveProperty('disabled', true);
	});

	it('enables Start and disables Stop while idle', () => {
		renderPanel({ recording: idle });

		expect(screen.getByText('Not recording')).toBeTruthy();
		expect(screen.getByText('IDLE')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Start Recording' })).toHaveProperty(
			'disabled',
			false
		);
		expect(screen.getByRole('button', { name: 'Stop Recording' })).toHaveProperty('disabled', true);
	});

	it('shows REC, disables Start, and enables Stop while recording', () => {
		renderPanel({ recording: live });

		expect(screen.getByText('REC')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Start Recording' })).toHaveProperty(
			'disabled',
			true
		);
		expect(screen.getByRole('button', { name: 'Stop Recording' })).toHaveProperty(
			'disabled',
			false
		);
	});

	it('calls startRecording and invokes success callbacks after start', async () => {
		const next = { ...live, durationMs: 0 };
		vi.mocked(startRecording).mockResolvedValue(next);
		const { onrecording, onaction } = renderPanel({ recording: idle });

		await fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }));

		await waitFor(() => {
			expect(startRecording).toHaveBeenCalledTimes(1);
			expect(onrecording).toHaveBeenCalledWith(next);
			expect(onaction).toHaveBeenCalledTimes(1);
		});
	});

	it('calls stopRecording and clears the busy state after a successful stop', async () => {
		const stopped = { ...idle, fileName: 'clip.mkv', durationMs: 8_000 };
		let finish!: (value: RecordingStatus) => void;
		vi.mocked(stopRecording).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const { onrecording, onaction } = renderPanel({ recording: live });

		await fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));
		expect(screen.getByRole('button', { name: 'Stopping…' })).toBeTruthy();

		finish(stopped);

		await waitFor(() => {
			expect(stopRecording).toHaveBeenCalledTimes(1);
			expect(onrecording).toHaveBeenCalledWith(stopped);
			expect(onaction).toHaveBeenCalledTimes(1);
			expect(screen.getByRole('button', { name: 'Stop Recording' })).toBeTruthy();
		});
	});

	it('shows an accessible error and skips success callbacks when start fails', async () => {
		vi.mocked(startRecording).mockRejectedValue(
			new ApiError('RECORDING_CONFLICT', 'OBS is already recording.', 409)
		);
		const { onrecording, onaction } = renderPanel({ recording: idle });

		await fireEvent.click(screen.getByRole('button', { name: 'Start Recording' }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toBe('OBS is already recording.');
		});
		expect(onrecording).not.toHaveBeenCalled();
		expect(onaction).not.toHaveBeenCalled();
	});

	it('shows an accessible error and skips success callbacks when stop fails', async () => {
		vi.mocked(stopRecording).mockRejectedValue(
			new ApiError('RECORDING_CONFLICT', 'OBS is not recording.', 409)
		);
		const { onrecording, onaction } = renderPanel({ recording: live });

		await fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toBe('OBS is not recording.');
		});
		expect(onrecording).not.toHaveBeenCalled();
		expect(onaction).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Stop Recording' })).toHaveProperty(
			'disabled',
			false
		);
	});

	it('keeps the last live duration when stop reports durationMs 0', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
		vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'));

		const { rerender, onrecording, onaction } = renderPanel({ recording: live });
		expect(screen.getByRole('time').textContent).toBe('00:00:05');

		await vi.advanceTimersByTimeAsync(1_000);
		expect(screen.getByRole('time').textContent).toBe('00:00:06');

		const stopped = { ...idle, fileName: 'clip.mkv', durationMs: 0 };
		vi.mocked(stopRecording).mockResolvedValue(stopped);

		await fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));
		await waitFor(() => {
			expect(onrecording).toHaveBeenCalledWith(stopped);
		});

		await rerender({
			recording: stopped,
			loading: false,
			error: null,
			onrecording,
			onaction
		});

		expect(screen.getByRole('time').textContent).toBe('00:00:06');
	});
});
