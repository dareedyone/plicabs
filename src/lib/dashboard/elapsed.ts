/** Formats a duration as HH:MM:SS. Invalid or negative values become 00:00:00. */
export function formatElapsed(ms: number): string {
	const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const seconds = safe % 60;
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Live elapsed time from an API duration snapshot and the wall clock since that snapshot. */
export function liveDurationMs(baseMs: number, since: number, now: number): number {
	const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 0;
	const elapsed = Number.isFinite(now) && Number.isFinite(since) ? now - since : 0;
	return base + Math.max(0, elapsed);
}

/**
 * Prefer the stop response duration when OBS reports one; otherwise keep the
 * last live counter from this page session.
 */
export function retainedStopDurationMs(stopDurationMs: number, lastLiveMs: number): number {
	if (Number.isFinite(stopDurationMs) && stopDurationMs > 0) {
		return stopDurationMs;
	}
	return Number.isFinite(lastLiveMs) && lastLiveMs > 0 ? lastLiveMs : 0;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}
