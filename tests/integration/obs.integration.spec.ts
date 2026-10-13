import { afterEach, describe, expect, it } from 'vitest';

const baseUrl = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const absoluteBaseUrl = (() => {
	try {
		return new URL(baseUrl).toString().replace(/\/$/, '');
	} catch {
		throw new Error(`BASE_URL must be an absolute URL, received: ${baseUrl}`);
	}
})();
const supportsFetch = typeof fetch === 'function';
const supportsReadableStream =
	typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';

function toAbsoluteUrl(path: string) {
	return new URL(path, `${absoluteBaseUrl}/`).toString();
}

async function fetchJson(path: string, init: RequestInit = {}, timeoutMs = 15000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(toAbsoluteUrl(path), {
			...init,
			signal: controller.signal,
			headers: {
				Accept: 'application/json',
				...(init.headers ?? {})
			}
		});
		const body = await response.text();
		let json: unknown = body;
		if (body) {
			try {
				json = JSON.parse(body);
			} catch {
				json = body;
			}
		}
		return { response, json };
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`Timed out fetching ${path} after ${timeoutMs}ms`, { cause: error });
		}
		throw new Error(
			`Fetch failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
			{
				cause: error
			}
		);
	} finally {
		clearTimeout(timer);
	}
}

async function probeHealth(timeoutMs = 5000) {
	try {
		const { response } = await fetchJson('/api/health', {}, timeoutMs);
		return response.ok ? response : null;
	} catch (error) {
		console.warn('Health check unavailable:', error);
		return null;
	}
}

async function waitForJson<T>(path: string, predicate: (value: T) => boolean, timeoutMs = 15000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const { response, json } = await fetchJson(path, {}, timeoutMs);
		if (response.ok && predicate(json as T)) {
			return json as T;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for ${path}`);
}

function parseSseBlocks(
	input: string,
	onMessage: (event: string, payload: unknown) => void
): string {
	const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const blocks = normalized.split('\n\n');
	const trailing = blocks.pop() ?? '';
	for (const block of blocks) {
		const lines = block.split('\n');
		if (!lines.some((line) => line.trim())) continue;
		let eventName: string | null = null;
		let data = '';
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (trimmed.startsWith('event:')) {
				eventName = trimmed.slice(6).trim();
			} else if (trimmed.startsWith('data:')) {
				data += `${trimmed.slice(5).trim()}\n`;
			}
		}
		if (!eventName || !data.trim()) continue;
		let payload: unknown;
		try {
			payload = JSON.parse(data.trim());
		} catch (error) {
			console.warn(`Ignoring malformed SSE payload for ${eventName}:`, error);
			continue;
		}
		try {
			onMessage(eventName, payload);
		} catch (error) {
			console.warn(`SSE callback failed for ${eventName}:`, error);
		}
	}
	return trailing;
}

async function connectSse(url: string) {
	if (!supportsFetch || !supportsReadableStream) {
		throw new Error('SSE streaming requires fetch + ReadableStream support.');
	}
	const controller = new AbortController();
	const response = await fetch(toAbsoluteUrl(url), {
		headers: { Accept: 'text/event-stream' },
		signal: controller.signal
	});
	if (!response.ok || !response.body) {
		throw new Error(`Unable to open SSE stream: ${response.status}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const events: Array<{ event: string; data: unknown }> = [];
	let buffered = '';
	let snapshot: unknown = null;
	let closed = false;

	const pump = async () => {
		try {
			while (!closed) {
				const { value, done } = await reader.read();
				if (done) {
					buffered += decoder.decode();
					if (buffered.trim()) {
						buffered = parseSseBlocks(buffered, (event, payload) => {
							events.push({ event, data: payload });
							if (event === 'snapshot') snapshot = payload;
						});
					}
					break;
				}
				if (!value) continue;
				buffered = parseSseBlocks(
					`${buffered}${decoder.decode(value, { stream: true })}`,
					(event, payload) => {
						events.push({ event, data: payload });
						if (event === 'snapshot') snapshot = payload;
					}
				);
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}
			console.warn('SSE parser aborted unexpectedly:', error);
		} finally {
			closed = true;
			controller.abort();
			try {
				await reader.cancel();
			} catch {
				// ignore shutdown cancellation errors
			}
		}
	};

	const done = pump();
	return {
		async waitForSnapshot(timeoutMs = 15000) {
			const start = Date.now();
			while (Date.now() - start < timeoutMs) {
				if (snapshot) return snapshot;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			throw new Error('Timed out waiting for an SSE snapshot.');
		},
		async close() {
			if (closed) return;
			closed = true;
			controller.abort();
			try {
				await reader.cancel();
			} catch {
				// ignore shutdown cancellation errors
			}
			await done.catch(() => undefined);
		},
		events
	};
}

const healthStatus = await probeHealth();
const integrationReady = Boolean(healthStatus);
if (!integrationReady) {
	console.warn(
		`Skipping OBS integration smoke tests: the application is unavailable at ${absoluteBaseUrl}.`
	);
}
const describeIfReady = integrationReady ? describe : describe.skip;

const sceneMutationReady = await (async () => {
	try {
		const scenesResponse = await fetchJson('/api/obs/scenes');
		if (!scenesResponse.response.ok) return false;
		const payload = scenesResponse.json as { scenes?: string[]; currentScene?: string | null };
		return (
			Array.isArray(payload.scenes) && payload.scenes.length >= 2 && payload.currentScene != null
		);
	} catch {
		return false;
	}
})();

const recordingMutationReady = await (async () => {
	try {
		const recordingResponse = await fetchJson('/api/obs/recording');
		if (!recordingResponse.response.ok) return false;
		const payload = recordingResponse.json as { active?: boolean };
		return payload.active === false;
	} catch {
		return false;
	}
})();

const sceneMutationTest = sceneMutationReady ? it : it.skip;
const recordingMutationTest = recordingMutationReady ? it : it.skip;

if (!sceneMutationReady) {
	console.warn(
		`Skipping scene mutation checks: no valid scene switch target was detected at ${absoluteBaseUrl}.`
	);
}
if (!recordingMutationReady) {
	console.warn(
		`Skipping recording mutation checks: OBS is not idle or the recorder is unavailable at ${absoluteBaseUrl}.`
	);
}

describeIfReady('OBS integration smoke tests', () => {
	afterEach(async () => {
		await Promise.resolve();
	});

	it('checks the application health, scene list, and connection status', async () => {
		const health = await fetchJson('/api/health');
		expect(health.response.ok).toBe(true);
		expect(health.json).toEqual({ status: 'ok' });

		const sceneList = await fetchJson('/api/obs/scenes');
		expect(sceneList.response.ok).toBe(true);
		const scenePayload = sceneList.json as { scenes?: string[]; currentScene?: string | null };
		expect(Array.isArray(scenePayload.scenes)).toBe(true);
		const scenes = scenePayload.scenes ?? [];
		expect(scenes.length).toBeGreaterThan(0);

		const status = await fetchJson('/api/obs/status');
		expect(status.response.ok).toBe(true);
		const statusPayload = status.json as { state?: string; lastError?: string | null };
		expect(statusPayload.state).toBe('connected');
	});

	it('opens an SSE stream and observes the initial snapshot', async () => {
		const sse = await connectSse(`${baseUrl}/api/obs/events`);
		try {
			const snapshot = await sse.waitForSnapshot();
			expect(snapshot).toBeTruthy();
			const payload = snapshot as {
				connection?: { state?: string };
				scenes?: { currentScene?: string | null };
			};
			expect(payload.connection?.state).toBeDefined();
			expect(payload.scenes?.currentScene ?? null).not.toBeUndefined();
		} finally {
			await sse.close();
		}
	});

	sceneMutationTest(
		'switches scenes only when there are at least two available scenes and restores the original scene',
		async () => {
			const scenesResponse = await fetchJson('/api/obs/scenes');
			expect(scenesResponse.response.ok).toBe(true);
			const payload = scenesResponse.json as { scenes: string[]; currentScene: string | null };
			const originalScene = payload.currentScene;
			const nextScene = payload.scenes.find((name) => name !== originalScene) ?? null;
			if (
				!payload.scenes ||
				payload.scenes.length < 2 ||
				originalScene == null ||
				nextScene == null
			) {
				throw new Error('Scene mutation prerequisites are unavailable; refusing to switch scenes.');
			}

			let switchedScene = false;
			let cleanupError: unknown = null;
			try {
				const switchResult = await fetchJson('/api/obs/scenes/switch', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sceneName: nextScene })
				});
				if (!switchResult.response.ok) {
					throw new Error(
						`Scene switch failed: ${switchResult.response.status} ${switchResult.response.statusText}`
					);
				}
				const switched = switchResult.json as { currentScene: string | null };
				expect(switched.currentScene).toBe(nextScene);
				switchedScene = true;
			} finally {
				if (switchedScene && originalScene) {
					let restoreError: Error | null = null;
					try {
						const restoreResult = await fetchJson('/api/obs/scenes/switch', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ sceneName: originalScene })
						});
						if (!restoreResult.response.ok) {
							restoreError = new Error(
								`Scene restore failed: ${restoreResult.response.status} ${restoreResult.response.statusText}`
							);
						} else {
							const restored = restoreResult.json as { currentScene: string | null };
							if (restored.currentScene !== originalScene) {
								restoreError = new Error(
									`Expected scene restore to ${originalScene} but saw ${String(restored.currentScene)}`
								);
							}
						}
					} catch (error) {
						restoreError = new Error(
							`Scene cleanup failed after switching to ${nextScene}: ${error instanceof Error ? error.message : String(error)}`,
							{ cause: error }
						);
					}
					if (restoreError) {
						cleanupError = restoreError;
					}
				}
			}
			if (cleanupError) {
				throw cleanupError;
			}
		}
	);

	recordingMutationTest(
		'starts and stops a recording only when OBS is idle and the test owns the recording',
		async () => {
			const statusBefore = await fetchJson('/api/obs/recording');
			expect(statusBefore.response.ok).toBe(true);
			const recordState = statusBefore.json as { active?: boolean };
			if (recordState.active === undefined || recordState.active) {
				throw new Error(
					'Recording mutation prerequisites are unavailable or OBS is already recording.'
				);
			}

			let recordingOwned = false;
			let confirmedStopped = false;
			let cleanupError: unknown = null;
			try {
				const startResult = await fetchJson('/api/obs/recording/start', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({})
				});
				if (!startResult.response.ok) {
					throw new Error(
						`Failed to start recording: ${startResult.response.status} ${startResult.response.statusText}`
					);
				}
				const started = startResult.json as { active?: boolean };
				if (started.active !== true) {
					throw new Error(
						'Recording start did not confirm ownership; refusing to stop a recording.'
					);
				}
				recordingOwned = true;

				await waitForJson<{ active?: boolean }>('/api/obs/recording', (value) =>
					Boolean((value as { active?: boolean })?.active)
				);

				const stopResult = await fetchJson('/api/obs/recording/stop', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({})
				});
				if (!stopResult.response.ok) {
					throw new Error(
						`Expected recording stop to succeed: ${stopResult.response.status} ${stopResult.response.statusText}`
					);
				}
				const stopped = stopResult.json as { active?: boolean };
				expect(stopped.active).toBe(false);
				confirmedStopped = true;
			} finally {
				if (recordingOwned && !confirmedStopped) {
					let cleanupFailure: Error | null = null;
					try {
						const cleanupResult = await fetchJson('/api/obs/recording/stop', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({})
						});
						if (!cleanupResult.response.ok) {
							cleanupFailure = new Error(
								`Recording cleanup failed: ${cleanupResult.response.status} ${cleanupResult.response.statusText}`
							);
						} else {
							const cleanupState = cleanupResult.json as { active?: boolean };
							if (cleanupState.active !== false) {
								cleanupFailure = new Error(
									'Recording cleanup did not stop the test-owned recording.'
								);
							}
						}
					} catch (error) {
						cleanupFailure = new Error(
							`Recording cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
							{ cause: error }
						);
					}
					if (cleanupFailure) {
						cleanupError = cleanupFailure;
					}
				}
			}
			if (cleanupError) {
				throw cleanupError;
			}
		}
	);

	it('closes an active SSE connection cleanly during test teardown', async () => {
		const sse = await connectSse(`${baseUrl}/api/obs/events`);
		const snapshot = await sse.waitForSnapshot();
		expect(snapshot).toBeTruthy();
		await sse.close();
	});
});
