import { describe, expect, it } from 'vitest';
import { formatElapsed, isLiveClock, liveDurationMs, retainedStopDurationMs } from './elapsed';

describe('formatElapsed', () => {
	it('formats a duration as HH:MM:SS', () => {
		expect(formatElapsed(0)).toBe('00:00:00');
		expect(formatElapsed(1000)).toBe('00:00:01');
		expect(formatElapsed(61_000)).toBe('00:01:01');
		expect(formatElapsed(3_661_000)).toBe('01:01:01');
	});

	it('does not invent time from invalid values', () => {
		expect(formatElapsed(-12)).toBe('00:00:00');
		expect(formatElapsed(Number.NaN)).toBe('00:00:00');
	});
});

describe('isLiveClock', () => {
	it('advances only while recording and not paused', () => {
		expect(isLiveClock({ active: true, paused: false })).toBe(true);
		expect(isLiveClock({ active: true, paused: true })).toBe(false);
		expect(isLiveClock({ active: false, paused: false })).toBe(false);
		expect(isLiveClock(null)).toBe(false);
	});
});

describe('liveDurationMs', () => {
	it('adds wall-clock time to the API snapshot', () => {
		expect(liveDurationMs(1_000, 10_000, 12_500)).toBe(3_500);
	});

	it('does not run backwards if the clock is skewed', () => {
		expect(liveDurationMs(1_000, 12_000, 10_000)).toBe(1_000);
	});
});

describe('retainedStopDurationMs', () => {
	it('keeps the stop response duration when OBS reports one', () => {
		expect(retainedStopDurationMs(5_000, 4_800)).toBe(5_000);
	});

	it('keeps the last live counter when the stop response duration is 0', () => {
		expect(retainedStopDurationMs(0, 4_800)).toBe(4_800);
	});

	it('does not treat a zero stopped-state duration as the final length', () => {
		expect(retainedStopDurationMs(0, 6_250)).toBe(6_250);
		expect(retainedStopDurationMs(Number.NaN, 6_250)).toBe(6_250);
	});
});
