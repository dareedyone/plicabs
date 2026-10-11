import { describe, expect, it } from 'vitest';
import { obsWebSocketUrl, parseObsHost, parseObsPassword, parseObsPort } from './config';

describe('parseObsHost', () => {
	it.each(['127.0.0.1', 'localhost', 'host.docker.internal', 'obs-pc.local', '[::1]'])(
		'accepts %s',
		(host) => {
			expect(parseObsHost(host)).toBe(host);
		}
	);

	it('trims surrounding whitespace', () => {
		expect(parseObsHost('  127.0.0.1 ')).toBe('127.0.0.1');
	});

	it.each([undefined, '', '   '])('rejects a missing value (%j)', (value) => {
		expect(() => parseObsHost(value)).toThrow('OBS_HOST is required');
	});

	it.each([
		'ws://127.0.0.1',
		'127.0.0.1:4455',
		'localhost/path',
		'user:pass@localhost',
		'obs host',
		'999.1.1.1'
	])('rejects %s', (host) => {
		expect(() => parseObsHost(host)).toThrow('OBS_HOST must be a hostname or IP address');
	});
});

describe('parseObsPort', () => {
	it.each([
		['4455', 4455],
		[' 4455 ', 4455],
		['1', 1],
		['65535', 65535]
	])('parses %j as %i', (value, expected) => {
		expect(parseObsPort(value)).toBe(expected);
	});

	it.each([undefined, '', '  '])('rejects a missing value (%j)', (value) => {
		expect(() => parseObsPort(value)).toThrow('OBS_PORT is required');
	});

	it.each(['0', '65536', '-1', '44.5', '4455abc', 'abc', '1e3'])('rejects %j', (value) => {
		expect(() => parseObsPort(value)).toThrow('OBS_PORT must be a whole number from 1 to 65535');
	});
});

describe('parseObsPassword', () => {
	it('returns undefined when unset or empty, meaning authentication is disabled', () => {
		expect(parseObsPassword(undefined)).toBeUndefined();
		expect(parseObsPassword('')).toBeUndefined();
	});

	it('returns the password unchanged, including surrounding spaces', () => {
		expect(parseObsPassword(' test-password ')).toBe(' test-password ');
	});
});

describe('validation messages', () => {
	it('never include the rejected value', () => {
		const secretLooking = 'not-a-port-secret';
		expect(() => parseObsPort(secretLooking)).toThrow(
			expect.objectContaining({ message: expect.not.stringContaining(secretLooking) })
		);
		expect(() => parseObsHost(`${secretLooking}:1`)).toThrow(
			expect.objectContaining({ message: expect.not.stringContaining(secretLooking) })
		);
	});
});

describe('obsWebSocketUrl', () => {
	it('builds a ws:// URL from host and port', () => {
		expect(obsWebSocketUrl({ host: '127.0.0.1', port: 4455 })).toBe('ws://127.0.0.1:4455');
		expect(obsWebSocketUrl({ host: '[::1]', port: 4455 })).toBe('ws://[::1]:4455');
	});
});
