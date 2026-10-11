export type ObsRequestErrorCode =
	| 'RECORDING_CONFLICT'
	| 'SCENE_CONFLICT'
	| 'SCENE_NOT_FOUND'
	| 'INVALID_REQUEST'
	| 'OBS_REQUEST_FAILED';

/** An OBS request failure with a stable, user-safe message. */
export class ObsRequestError extends Error {
	readonly code: ObsRequestErrorCode;

	constructor(code: ObsRequestErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ObsRequestError';
		this.code = code;
	}
}
