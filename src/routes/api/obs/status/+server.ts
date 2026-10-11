import { getObsConnection, type ObsConnectionStatus } from '#lib/server/obs/connection.js';
import type { RequestHandler } from './$types';

/**
 * Reports the shared connection's last known status. It never connects: a disconnected OBS is a
 * normal answer (200), and the state only changes when another route calls `connect()`.
 */
export const GET: RequestHandler = () => {
	const { state, lastError } = getObsConnection().status;
	return Response.json({ state, lastError } satisfies ObsConnectionStatus);
};
