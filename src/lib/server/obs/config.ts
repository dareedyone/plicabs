export interface ObsConfig {
	host: string;
	port: number;
	/** `undefined` when the OBS WebSocket server has authentication disabled. */
	password: string | undefined;
}

// Validators used as `schema` functions in `src/env.ts`. SvelteKit runs them when the app
// starts and reports the thrown message, so messages must never include the value.

export function parseObsHost(value: string | undefined): string {
	const host = value?.trim();
	if (!host) {
		throw new Error('OBS_HOST is required, e.g. 127.0.0.1');
	}
	// The URL parser normalises the hostname, so any extra parts (protocol, port, path,
	// credentials) or invalid characters make it differ from the input.
	if (URL.parse(`ws://${host}`)?.hostname !== host.toLowerCase()) {
		throw new Error('OBS_HOST must be a hostname or IP address, without a protocol, port or path');
	}
	return host;
}

export function parseObsPort(value: string | undefined): number {
	const raw = value?.trim();
	if (!raw) {
		throw new Error('OBS_PORT is required (the OBS default is 4455)');
	}
	const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('OBS_PORT must be a whole number from 1 to 65535');
	}
	return port;
}

/** An unset or empty value means OBS has authentication disabled. */
export function parseObsPassword(value: string | undefined): string | undefined {
	return value === undefined || value === '' ? undefined : value;
}

export function obsWebSocketUrl({ host, port }: Pick<ObsConfig, 'host' | 'port'>): string {
	return `ws://${host}:${port}`;
}
