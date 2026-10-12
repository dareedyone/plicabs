import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ConnectionHeader from './ConnectionHeader.svelte';

describe('ConnectionHeader', () => {
	it('shows Checking connection while loading with no status', () => {
		render(ConnectionHeader, {
			props: { status: null, loading: true, error: null }
		});

		expect(screen.getByText('Checking connection')).toBeTruthy();
	});

	it('shows Connected when the status is connected', () => {
		render(ConnectionHeader, {
			props: {
				status: { state: 'connected', lastError: null },
				loading: false,
				error: null
			}
		});

		expect(screen.getByText('Connected')).toBeTruthy();
	});

	it('shows the OBS unavailable detail when disconnected', () => {
		render(ConnectionHeader, {
			props: {
				status: { state: 'disconnected', lastError: 'OBS_UNAVAILABLE' },
				loading: false,
				error: null
			}
		});

		expect(screen.getByRole('status').textContent).toBe('Could not connect to OBS.');
	});

	it('shows a supplied page-level error', () => {
		render(ConnectionHeader, {
			props: {
				status: { state: 'disconnected', lastError: null },
				loading: false,
				error: 'Could not reach the app server. Check that it is running.'
			}
		});

		expect(screen.getByRole('status').textContent).toBe(
			'Could not reach the app server. Check that it is running.'
		);
	});
});
