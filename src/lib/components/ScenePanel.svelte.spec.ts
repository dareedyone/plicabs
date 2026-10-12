import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError, switchScene, type SceneList } from '#lib/dashboard/api.js';
import ScenePanel from './ScenePanel.svelte';

vi.mock('#lib/dashboard/api.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/dashboard/api.js')>();
	return { ...actual, switchScene: vi.fn() };
});

afterEach(() => {
	vi.mocked(switchScene).mockReset();
});

const scenes: SceneList = { scenes: ['Cam', 'Screen'], currentScene: 'Cam' };

function renderPanel(
	overrides: Partial<{
		scenes: SceneList | null;
		loading: boolean;
		error: string | null;
	}> = {}
) {
	const onscenes = vi.fn();
	const onaction = vi.fn();
	const view = render(ScenePanel, {
		props: {
			scenes: null,
			loading: false,
			error: null,
			onscenes,
			onaction,
			...overrides
		}
	});
	return { ...view, onscenes, onaction };
}

describe('ScenePanel', () => {
	it('shows a loading message before the scene list arrives', () => {
		renderPanel({ loading: true, scenes: null });

		expect(screen.getByText('Loading scenes')).toBeTruthy();
		expect(screen.getByText('Fetching the scene list from OBS…')).toBeTruthy();
	});

	it('shows an empty state when OBS has no scenes', () => {
		renderPanel({ scenes: { scenes: [], currentScene: null } });

		expect(screen.getByText('No program scene')).toBeTruthy();
		expect(
			screen.getByText('No scenes are available. Add a scene in OBS, then reload this page.')
		).toBeTruthy();
	});

	it('lists available scenes and marks the current program scene', () => {
		renderPanel({ scenes });

		expect(screen.getByText('On air: Cam')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Cam Program' }).getAttribute('aria-current')).toBe(
			'true'
		);
		expect(
			screen.getByRole('button', { name: 'Screen Switch' }).getAttribute('aria-current')
		).toBeNull();
	});

	it('calls switchScene with the selected scene name', async () => {
		const next = { scenes: ['Cam', 'Screen'], currentScene: 'Screen' };
		vi.mocked(switchScene).mockResolvedValue(next);
		renderPanel({ scenes });

		await fireEvent.click(screen.getByRole('button', { name: 'Screen Switch' }));

		await waitFor(() => {
			expect(switchScene).toHaveBeenCalledWith('Screen');
		});
	});

	it('invokes onscenes and onaction after a successful switch', async () => {
		const next = { scenes: ['Cam', 'Screen'], currentScene: 'Screen' };
		vi.mocked(switchScene).mockResolvedValue(next);
		const { onscenes, onaction } = renderPanel({ scenes });

		await fireEvent.click(screen.getByRole('button', { name: 'Screen Switch' }));

		await waitFor(() => {
			expect(onscenes).toHaveBeenCalledWith(next);
			expect(onaction).toHaveBeenCalledTimes(1);
		});
	});

	it('shows an accessible error and skips success callbacks when a switch fails', async () => {
		vi.mocked(switchScene).mockRejectedValue(
			new ApiError('SCENE_NOT_FOUND', 'That scene was not found.', 404)
		);
		const { onscenes, onaction } = renderPanel({ scenes });

		await fireEvent.click(screen.getByRole('button', { name: 'Screen Switch' }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toBe('That scene was not found.');
		});
		expect(onscenes).not.toHaveBeenCalled();
		expect(onaction).not.toHaveBeenCalled();
	});

	it('does not request a switch for the current scene', async () => {
		renderPanel({ scenes });

		await fireEvent.click(screen.getByRole('button', { name: 'Cam Program' }));

		expect(switchScene).not.toHaveBeenCalled();
	});

	it('disables every scene button during a switch so a second click is ignored', async () => {
		let finish!: (value: SceneList) => void;
		vi.mocked(switchScene).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		renderPanel({ scenes });

		await fireEvent.click(screen.getByRole('button', { name: 'Screen Switch' }));

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Screen Switching' })).toHaveProperty(
				'disabled',
				true
			);
		});
		expect(screen.getByRole('button', { name: 'Cam Program' })).toHaveProperty('disabled', true);

		await fireEvent.click(screen.getByRole('button', { name: 'Cam Program' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Screen Switching' }));
		expect(switchScene).toHaveBeenCalledTimes(1);

		finish({ scenes: ['Cam', 'Screen'], currentScene: 'Screen' });
		await waitFor(() => {
			expect(switchScene).toHaveBeenCalledTimes(1);
		});
	});
});
