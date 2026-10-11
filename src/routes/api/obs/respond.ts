import { describeCause, ObsConnectionError } from '#lib/server/obs/connection.js';
import { ObsRequestError } from '#lib/server/obs/recording.js';

const HTTP_STATUS = {
	OBS_UNAVAILABLE: 503,
	OBS_AUTH_FAILED: 503,
	RECORDING_CONFLICT: 409,
	OBS_REQUEST_FAILED: 502
} as const;

/** Runs an OBS operation and maps known failures to a stable JSON error body. */
export async function obsHandle<T>(run: () => Promise<T>): Promise<Response> {
	try {
		return Response.json(await run());
	} catch (cause) {
		if (cause instanceof ObsConnectionError || cause instanceof ObsRequestError) {
			return Response.json(
				{ error: { code: cause.code, message: cause.message } },
				{ status: HTTP_STATUS[cause.code] }
			);
		}
		console.warn(`[obs] Unexpected error: ${describeCause(cause)}`);
		return Response.json(
			{ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
			{ status: 500 }
		);
	}
}
