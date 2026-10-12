import { OBSWebSocketError } from 'obs-websocket-js';
import {
	describeCause,
	getObsConnection,
	ObsConnectionError,
	type ObsConnection
} from './connection';
import { ObsRequestError } from './errors';

export { ObsRequestError, type ObsRequestErrorCode } from './errors';

/** OBS request status: the output is already running (`OutputRunning`). */
const OUTPUT_RUNNING = 500;
/** OBS request status: the output is not running (`OutputNotRunning`). */
const OUTPUT_NOT_RUNNING = 501;

/**
 * OBS StartRecord / StopRecord return before the output actually changes, so we
 * re-read GetRecordStatus until it matches or this budget is used up.
 */
const VERIFY_TIMEOUT_MS = 1_000;
const VERIFY_INTERVAL_MS = 50;

export interface RecordingStatus {
	active: boolean;
	paused: boolean;
	timecode: string;
	durationMs: number;
	/** Basename of the saved file after stop. `null` until OBS reports a path. */
	fileName: string | null;
}

type CachedFile = { name: string; live: boolean };

let cachedFile: CachedFile | null = null;

/** Last path segment only; the full output path can include the local username. */
export function fileNameOf(outputPath: string | undefined): string | null {
	if (!outputPath) {
		return null;
	}
	const name = outputPath.replace(/^.*[/\\]/, '');
	return name || null;
}

/**
 * Remember a path from `RecordFileChanged` (`live: true`) or from stop
 * (`StopRecord` / `RecordStateChanged`, `live: false`).
 */
export function rememberRecordingFile(path: unknown, live: boolean): string | null {
	const name = fileNameOf(typeof path === 'string' ? path : undefined);
	if (name) {
		cachedFile = { name, live };
	}
	return name;
}

/** A new recording started. Drop a leftover stopped-file name; keep one already marked live. */
export function onRecordingBecameActive(): void {
	if (!cachedFile?.live) {
		cachedFile = null;
	}
}

export function cachedRecordingFile(): string | null {
	return cachedFile?.name ?? null;
}

export function resetRecordingFileCache(): void {
	cachedFile = null;
}

export async function getRecordingStatus(): Promise<RecordingStatus> {
	return readStatus(getObsConnection());
}

/** Like GET status, but includes the cached basename when OBS has reported a path. */
export async function getLiveRecordingStatus(): Promise<RecordingStatus> {
	const status = await readStatus(getObsConnection());
	return { ...status, fileName: cachedFile?.name ?? status.fileName };
}

export async function startRecording(): Promise<RecordingStatus> {
	return changeRecording('start');
}

export async function stopRecording(): Promise<RecordingStatus> {
	return changeRecording('stop');
}

async function changeRecording(action: 'start' | 'stop'): Promise<RecordingStatus> {
	const connection = getObsConnection();
	const wantActive = action === 'start';
	const current = await readStatus(connection);
	if (current.active === wantActive) {
		throw new ObsRequestError(
			'RECORDING_CONFLICT',
			wantActive ? 'OBS is already recording.' : 'OBS is not recording.'
		);
	}

	const requestType = wantActive ? 'StartRecord' : 'StopRecord';
	let fileName: string | null = null;
	try {
		if (wantActive) {
			onRecordingBecameActive();
			await connection.request('StartRecord');
		} else {
			const { outputPath } = await connection.request('StopRecord');
			fileName = rememberRecordingFile(outputPath, false);
		}
	} catch (cause) {
		throw toRecordingError(cause, requestType);
	}

	const confirmed = await waitUntil(connection, wantActive);
	console.info(
		wantActive
			? '[obs] Recording started'
			: `[obs] Recording stopped${fileName ? ` (${fileName})` : ''}`
	);
	return { ...confirmed, fileName };
}

async function readStatus(connection: ObsConnection): Promise<RecordingStatus> {
	try {
		const raw = await connection.request('GetRecordStatus');
		return {
			active: raw.outputActive,
			paused: raw.outputPaused,
			timecode: raw.outputTimecode,
			durationMs: raw.outputDuration,
			fileName: null
		};
	} catch (cause) {
		throw toRecordingError(cause, 'GetRecordStatus');
	}
}

async function waitUntil(connection: ObsConnection, active: boolean): Promise<RecordingStatus> {
	const deadline = Date.now() + VERIFY_TIMEOUT_MS;
	for (;;) {
		const status = await readStatus(connection);
		if (status.active === active) {
			return status;
		}
		if (Date.now() >= deadline) {
			throw new ObsRequestError(
				'OBS_REQUEST_FAILED',
				'The recording change is unconfirmed. Check the recording status before retrying.'
			);
		}
		await new Promise((resolve) => setTimeout(resolve, VERIFY_INTERVAL_MS));
	}
}

function toRecordingError(cause: unknown, requestType: string): Error {
	if (cause instanceof ObsConnectionError || cause instanceof ObsRequestError) {
		return cause;
	}
	if (cause instanceof OBSWebSocketError) {
		console.warn(`[obs] ${requestType} failed: ${describeCause(cause)}`);
		if (cause.code === OUTPUT_RUNNING) {
			return new ObsRequestError('RECORDING_CONFLICT', 'OBS is already recording.', { cause });
		}
		if (cause.code === OUTPUT_NOT_RUNNING) {
			return new ObsRequestError('RECORDING_CONFLICT', 'OBS is not recording.', { cause });
		}
		return new ObsRequestError(
			'OBS_REQUEST_FAILED',
			'OBS could not complete the recording request.',
			{
				cause
			}
		);
	}
	console.warn(`[obs] ${requestType} failed: ${describeCause(cause)}`);
	return new ObsRequestError(
		'OBS_REQUEST_FAILED',
		'OBS could not complete the recording request.',
		{
			cause
		}
	);
}
