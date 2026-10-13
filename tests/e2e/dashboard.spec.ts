import { expect, test, type Page } from '@playwright/test';

type MockStatus = {
	state: 'connected' | 'connecting' | 'disconnected';
	lastError: 'OBS_UNAVAILABLE' | 'OBS_AUTH_FAILED' | null;
};

type MockRecording = {
	active: boolean;
	paused: boolean;
	timecode: string;
	durationMs: number;
	fileName: string | null;
};

type MockScenes = {
	scenes: string[];
	currentScene: string | null;
};

type MockFailure = {
	status: number;
	code: string;
	message: string;
	url: string;
};

type MockState = {
	status: MockStatus;
	recording: MockRecording;
	scenes: MockScenes;
	blockStatus: boolean;
	statusGate: Promise<void> | null;
	failNext: MockFailure | null;
};

const defaultStatus: MockStatus = { state: 'connected', lastError: null };
const defaultRecording: MockRecording = {
	active: false,
	paused: false,
	timecode: '00:00:00.000',
	durationMs: 0,
	fileName: null
};
const defaultScenes: MockScenes = { scenes: ['Screen', 'Cam'], currentScene: 'Screen' };

async function installHarness(page: Page, options: Partial<MockState> = {}) {
	const state: MockState = {
		status: options.status ?? defaultStatus,
		recording: options.recording ?? defaultRecording,
		scenes: options.scenes ?? defaultScenes,
		blockStatus: options.blockStatus ?? false,
		statusGate: options.statusGate ?? null,
		failNext: options.failNext ?? null
	};

	await page.addInitScript(() => {
		class MockEventSource {
			url: string;
			readyState = 1;
			listeners = new Map<string, Array<(event: { data: string; type: string }) => void>>();

			constructor(url: string) {
				this.url = url;
				const bound = window as typeof window & {
					__obsHarness?: {
						eventSources: MockEventSource[];
						emit: (type: string, payload: unknown) => void;
					};
				};
				bound.__obsHarness ??= { eventSources: [], emit: () => undefined };
				bound.__obsHarness.eventSources.push(this);
			}

			addEventListener(type: string, listener: (event: { data: string; type: string }) => void) {
				const listeners = this.listeners.get(type) ?? [];
				listeners.push(listener);
				this.listeners.set(type, listeners);
			}

			close() {
				this.readyState = 2;
			}

			emit(type: string, payload: unknown) {
				for (const listener of this.listeners.get(type) ?? []) {
					listener({ data: JSON.stringify(payload), type });
				}
			}
		}

		const harness = {
			eventSources: [] as MockEventSource[],
			emit(type: string, payload: unknown) {
				const source = harness.eventSources.at(-1);
				source?.emit(type, payload);
			}
		};
		(window as typeof window & { __obsHarness?: typeof harness }).__obsHarness = harness;
		Object.defineProperty(window, 'EventSource', {
			configurable: true,
			value: MockEventSource,
			writable: true
		});
	});

	await page.route('**/api/obs/status', async (route) => {
		const staleStatus = { ...state.status };
		if (state.blockStatus) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		if (state.statusGate) {
			await state.statusGate;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(staleStatus)
		});
	});
	await page.route('**/api/obs/recording', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(state.recording)
		});
	});
	await page.route('**/api/obs/scenes', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(state.scenes)
		});
	});
	await page.route('**/api/obs/recording/start', async (route) => {
		if (state.failNext && route.request().url().includes('/api/obs/recording/start')) {
			const failure = state.failNext;
			state.failNext = null;
			await route.fulfill({
				status: failure.status,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: failure.code, message: failure.message } })
			});
			return;
		}
		state.recording = {
			active: true,
			paused: false,
			timecode: '00:00:05.000',
			durationMs: 5000,
			fileName: 'clip.mkv'
		};
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(state.recording)
		});
	});
	await page.route('**/api/obs/recording/stop', async (route) => {
		if (state.failNext && route.request().url().includes('/api/obs/recording/stop')) {
			const failure = state.failNext;
			state.failNext = null;
			await route.fulfill({
				status: failure.status,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: failure.code, message: failure.message } })
			});
			return;
		}
		state.recording = {
			...state.recording,
			active: false,
			paused: false,
			fileName: state.recording.fileName ?? 'clip.mkv',
			timecode: '00:00:05.000',
			durationMs: 5000
		};
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(state.recording)
		});
	});
	await page.route('**/api/obs/scenes/switch', async (route) => {
		if (state.failNext && route.request().url().includes('/api/obs/scenes/switch')) {
			const failure = state.failNext;
			state.failNext = null;
			await route.fulfill({
				status: failure.status,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: failure.code, message: failure.message } })
			});
			return;
		}
		const body = route.request().postDataJSON();
		if (body && typeof body === 'object' && 'sceneName' in body) {
			state.scenes = {
				...state.scenes,
				currentScene: String(body.sceneName)
			};
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(state.scenes)
		});
	});

	return {
		state,
		emit: async (type: string, payload: unknown) => {
			await page.evaluate(
				({ type: eventType, payload: eventPayload }) => {
					const bound = window as typeof window & {
						__obsHarness?: { emit: (type: string, payload: unknown) => void };
					};
					bound.__obsHarness?.emit(eventType, eventPayload);
				},
				{ type, payload }
			);
		}
	};
}

test('dashboard loads initial data and opens an SSE stream', async ({ page }) => {
	await installHarness(page);
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'OBS Control' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Scenes' })).toBeVisible();
	await expect(page.getByText('Connected')).toBeVisible();
	await expect(page.getByText('On air: Screen')).toBeVisible();

	await expect
		.poll(async () => {
			const bound = await page.evaluate(() => {
				const windowWithHarness = window as typeof window & {
					__obsHarness?: { eventSources: Array<{ url: string }> };
				};
				return windowWithHarness.__obsHarness?.eventSources ?? [];
			});
			return bound.length;
		})
		.toBeGreaterThan(0);
	await expect
		.poll(async () => {
			const bound = await page.evaluate(() => {
				const windowWithHarness = window as typeof window & {
					__obsHarness?: { eventSources: Array<{ url: string }> };
				};
				return windowWithHarness.__obsHarness?.eventSources.at(-1)?.url ?? '';
			});
			return bound;
		})
		.toBe('/api/obs/events');
});

test('stale HTTP state does not overwrite a newer SSE snapshot', async ({ page }) => {
	let resolveStatus!: () => void;
	const statusGate = new Promise<void>((resolve) => {
		resolveStatus = resolve;
	});
	const harness = await installHarness(page, {
		status: { state: 'disconnected', lastError: 'OBS_UNAVAILABLE' },
		statusGate
	});
	await page.goto('/');

	await page.waitForFunction(() => {
		const bound = window as typeof window & {
			__obsHarness?: { eventSources: Array<{ url: string }> };
		};
		return (bound.__obsHarness?.eventSources?.length ?? 0) > 0;
	});
	await harness.emit('snapshot', {
		connection: { state: 'connected', lastError: null },
		recording: {
			active: true,
			paused: false,
			timecode: '00:00:02.000',
			durationMs: 2000,
			fileName: 'live.mkv'
		},
		scenes: { scenes: ['Screen', 'Cam'], currentScene: 'Cam' }
	});
	await expect(page.getByText('Connected')).toBeVisible();
	await expect(page.getByText('On air: Cam')).toBeVisible();

	harness.state.status = { state: 'connected', lastError: null };
	resolveStatus();
	await expect(page.getByText('Connected')).toBeVisible();
	await expect(page.getByText('On air: Cam')).toBeVisible();
});

test('start and stop recording update the UI and surface API failures', async ({ page }) => {
	const harness = await installHarness(page, {
		status: { state: 'connected', lastError: null },
		recording: {
			active: false,
			paused: false,
			timecode: '00:00:00.000',
			durationMs: 0,
			fileName: null
		}
	});
	await page.goto('/');

	await page.getByRole('button', { name: 'Start Recording' }).click();
	await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
	await expect(page.getByText('clip.mkv')).toBeVisible();

	await page.getByRole('button', { name: 'Stop Recording' }).click();
	await expect(page.getByText('Not recording')).toBeVisible();

	harness.state.failNext = {
		status: 409,
		code: 'RECORDING_CONFLICT',
		message: 'Could not start recording.',
		url: '/api/obs/recording/start'
	};
	await page.getByRole('button', { name: 'Start Recording' }).click();
	await expect(page.getByRole('alert')).toContainText('Could not start recording.');
});

test('scene switching uses the active scene and handles failed updates', async ({ page }) => {
	const harness = await installHarness(page, {
		scenes: { scenes: ['Screen', 'Cam'], currentScene: 'Screen' }
	});
	await page.goto('/');

	await page
		.getByRole('button', { name: /Switch/ })
		.nth(0)
		.click();
	await expect(page.getByText('On air: Cam')).toBeVisible();

	harness.state.failNext = {
		status: 409,
		code: 'SCENE_CONFLICT',
		message: 'Could not change scene.',
		url: '/api/obs/scenes/switch'
	};
	harness.state.scenes = { scenes: ['Screen', 'Cam'], currentScene: 'Cam' };
	await page
		.getByRole('button', { name: /Switch/ })
		.nth(0)
		.click();
	await expect(page.getByRole('alert')).toContainText('Could not change scene.');
	await expect(page.getByText('On air: Cam')).toBeVisible();
});

test('recording timer advances while active and unpaused', async ({ page }) => {
	const harness = await installHarness(page, {
		recording: {
			active: true,
			paused: false,
			timecode: '00:00:00.000',
			durationMs: 0,
			fileName: 'clip.mkv'
		}
	});
	await page.goto('/');

	await expect
		.poll(
			async () => {
				const text = await page.locator('time').textContent();
				return text ?? '';
			},
			{ timeout: 4000 }
		)
		.not.toBe('00:00:00');
	await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
	harness.state.recording = {
		...harness.state.recording,
		active: false,
		paused: false,
		durationMs: 0,
		fileName: 'clip.mkv'
	};
});

test('recording timer does not advance while paused', async ({ page }) => {
	await installHarness(page, {
		recording: {
			active: true,
			paused: true,
			timecode: '00:00:12.000',
			durationMs: 12000,
			fileName: 'clip.mkv'
		}
	});
	await page.goto('/');

	const before = await page.locator('time').textContent();
	await expect
		.poll(async () => (await page.locator('time').textContent()) ?? '', { timeout: 1200 })
		.toBe(before ?? '');
});

test('last displayed recording duration is retained after stopping', async ({ page }) => {
	const harness = await installHarness(page, {
		recording: {
			active: true,
			paused: false,
			timecode: '00:00:01.000',
			durationMs: 1000,
			fileName: 'clip.mkv'
		}
	});
	await page.goto('/');
	await expect(page.getByText('00:00:01')).toBeVisible();

	harness.emit('recording', {
		active: false,
		paused: false,
		timecode: '00:00:01.000',
		durationMs: 0,
		fileName: 'clip.mkv'
	});
	await expect(page.getByText('00:00:01')).toBeVisible();
});

test('EventSource closes when the page unmounts', async ({ page }) => {
	await installHarness(page);
	await page.goto('/');
	await page.waitForFunction(() => {
		const bound = window as typeof window & {
			__obsHarness?: { eventSources: Array<{ readyState: number }> };
		};
		return (bound.__obsHarness?.eventSources?.length ?? 0) > 0;
	});

	await page.evaluate(() => {
		const bound = window as typeof window & {
			__obsHarness?: { eventSources: Array<{ readyState: number; close: () => void }> };
		};
		bound.__obsHarness?.eventSources.at(-1)?.close();
	});
	await expect
		.poll(async () => {
			return await page.evaluate(() => {
				const bound = window as typeof window & {
					__obsHarness?: { eventSources: Array<{ readyState: number }> };
				};
				return bound.__obsHarness?.eventSources.at(-1)?.readyState ?? null;
			});
		})
		.toBe(2);
});

test('live SSE updates replace the dashboard state without reloading', async ({ page }) => {
	const harness = await installHarness(page);
	await page.goto('/');
	await page.waitForFunction(() => {
		const bound = window as typeof window & {
			__obsHarness?: { eventSources: Array<{ url: string }> };
		};
		return (bound.__obsHarness?.eventSources?.length ?? 0) > 0;
	});
	const before = await page.evaluate(() => performance.getEntriesByType('navigation').length);
	await harness.emit('connection', { state: 'connecting', lastError: null });
	await harness.emit('recording', {
		active: true,
		paused: false,
		timecode: '00:00:01.000',
		durationMs: 1000,
		fileName: 'live.mkv'
	});
	await harness.emit('scenes', { scenes: ['Screen', 'Cam'], currentScene: 'Cam' });

	await expect(page.getByText('Connecting')).toBeVisible();
	await expect(page.getByText('On air: Cam')).toBeVisible();
	await expect(page.getByText('live.mkv')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Recording' })).toBeVisible();
	await expect
		.poll(async () => page.evaluate(() => performance.getEntriesByType('navigation').length))
		.toBe(before);
});
