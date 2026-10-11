import { building } from '$app/env';
import { defineEnvVars } from '@sveltejs/kit/env';
import { parseObsHost, parseObsPassword, parseObsPort } from '#lib/server/obs/config.js';

// All variables are private (importable only from `$app/env/private`) and read when the app starts.
// `vite build` also runs the app once to analyse it, with `building` set. Nothing connects to OBS
// then, so missing values get an unused placeholder instead of failing the build.
export const variables = defineEnvVars({
	OBS_HOST: {
		description:
			'Host running OBS Studio, e.g. 127.0.0.1 (host.docker.internal from Docker on macOS)',
		schema: (value) => (building && value === undefined ? '' : parseObsHost(value))
	},
	OBS_PORT: {
		description: 'OBS WebSocket server port (OBS default: 4455)',
		schema: (value) => (building && value === undefined ? 0 : parseObsPort(value))
	},
	OBS_PASSWORD: {
		description: 'OBS WebSocket server password. Leave unset if authentication is disabled in OBS.',
		schema: parseObsPassword
	}
});
