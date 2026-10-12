import OBSWebSocket, {
	EventSubscription,
	OBSWebSocketError,
	type OBSEventTypes,
	type OBSRequestTypes,
	type OBSResponseTypes
} from 'obs-websocket-js';
import { OBS_HOST, OBS_PASSWORD, OBS_PORT } from '$app/env/private';
import { obsWebSocketUrl, type ObsConfig } from './config';

/** WebSocket close code OBS sends when the password is missing or wrong (`AuthenticationFailed`). */
const AUTHENTICATION_FAILED = 4009;

/** obs-websocket-js has no connect timeout; an unreachable host could otherwise hang a request. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Scene list/program changes and recording output events. Not high-volume. */
export const OBS_EVENT_SUBSCRIPTIONS = EventSubscription.Scenes | EventSubscription.Outputs;

export type ObsConnectionState = 'disconnected' | 'connecting' | 'connected';
export type ObsConnectionErrorCode = 'OBS_UNAVAILABLE' | 'OBS_AUTH_FAILED';

export interface ObsConnectionStatus {
	state: ObsConnectionState;
	/** Why the last attempt failed or the last session ended. `null` after a successful connect. */
	lastError: ObsConnectionErrorCode | null;
}

/** A connection failure with a stable code and a message that is safe to show to users. */
export class ObsConnectionError extends Error {
	readonly code: ObsConnectionErrorCode;

	constructor(code: ObsConnectionErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ObsConnectionError';
		this.code = code;
	}
}

/**
 * Owns the single OBS WebSocket client for this server process. Nothing connects until
 * `connect()` is called; after a disconnection, the next `connect()` opens a new session.
 */
export class ObsConnection {
	readonly #client: OBSWebSocket;
	readonly #config: ObsConfig;
	#pending: Promise<void> | null = null;
	/**
	 * A timed-out attempt whose socket is still closing. obs-websocket-js holds one socket per
	 * client, so starting another attempt before this settles would leave two sockets open.
	 */
	#abandoned: Promise<void> | null = null;
	#lastError: ObsConnectionErrorCode | null = null;
	/** Set from a successful connect until the session closes, so failed attempts aren't reported as drops. */
	#sessionActive = false;
	readonly #statusListeners = new Set<(status: ObsConnectionStatus) => void>();

	constructor(config: ObsConfig, client: OBSWebSocket = new OBSWebSocket()) {
		this.#config = config;
		this.#client = client;
		this.#client.on('ConnectionClosed', (error) => this.#handleClosed(error));
	}

	/** Listen for connection-status changes. Returns an unsubscribe function. */
	onStatus(listener: (status: ObsConnectionStatus) => void): () => void {
		this.#statusListeners.add(listener);
		return () => {
			this.#statusListeners.delete(listener);
		};
	}

	/**
	 * Listen for an OBS protocol event on the shared client. Returns an unsubscribe function.
	 * Handlers must not log raw payloads; they can contain local filesystem paths.
	 */
	onObsEvent<K extends keyof OBSEventTypes>(
		event: K,
		handler: (payload: OBSEventTypes[K]) => void
	): () => void {
		this.#client.on(event as 'Identified', handler as () => void);
		return () => {
			this.#client.off(event as 'Identified', handler as () => void);
		};
	}

	get status(): ObsConnectionStatus {
		const state = this.isConnected() ? 'connected' : this.#pending ? 'connecting' : 'disconnected';
		return { state, lastError: this.#lastError };
	}

	/**
	 * True once OBS has accepted the connection and authentication. `identified` alone could
	 * briefly be true for an attempt that already timed out and is being closed.
	 */
	isConnected(): boolean {
		return this.#sessionActive && this.#client.identified;
	}

	/**
	 * Resolves when connected. Concurrent callers share one attempt.
	 * Rejects with an `ObsConnectionError`.
	 */
	connect(): Promise<void> {
		if (this.isConnected()) {
			return Promise.resolve();
		}
		if (this.#abandoned) {
			return Promise.reject(new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.'));
		}
		const started = this.#pending === null;
		this.#pending ??= this.#open().finally(() => {
			this.#pending = null;
			this.#notifyStatus();
		});
		if (started) {
			this.#notifyStatus();
		}
		return this.#pending;
	}

	async disconnect(): Promise<void> {
		this.#sessionActive = false;
		this.#lastError = null;
		await this.#client.disconnect();
		this.#notifyStatus();
	}

	/**
	 * Connects if needed, then sends an OBS request on the shared client.
	 * Connection failures stay `ObsConnectionError`. OBS request errors are rethrown
	 * as `OBSWebSocketError` so callers can map request-specific codes.
	 *
	 * obs-websocket-js `call()` only waits for `res:<id>`. On close it emits
	 * `ConnectionClosed` and then `cleanup()` removes that waiter, so the promise
	 * never settles. This races the public close event so a drop cannot hang a request.
	 */
	async request<Type extends keyof OBSRequestTypes>(
		requestType: Type,
		requestData?: OBSRequestTypes[Type]
	): Promise<OBSResponseTypes[Type]> {
		await this.connect();
		let onClosed!: (error: OBSWebSocketError) => void;
		const closed = new Promise<never>((_, reject) => {
			onClosed = reject;
			this.#client.once('ConnectionClosed', onClosed);
		});
		try {
			return await Promise.race([this.#client.call(requestType, requestData), closed]);
		} catch (cause) {
			if (cause instanceof ObsConnectionError) {
				throw cause;
			}
			// Close events carry WebSocket codes (1000–4999), including 4009. Classify
			// those from the error itself: `#handleClosed` may not have cleared the
			// session yet when this catch runs. OBS request statuses stay below 1000.
			if (isWebSocketCloseError(cause) || !this.isConnected()) {
				throw toConnectionError(cause);
			}
			throw cause;
		} finally {
			this.#client.off('ConnectionClosed', onClosed);
		}
	}

	async #open(): Promise<void> {
		const url = obsWebSocketUrl(this.#config);
		const attempt = this.#client.connect(url, this.#config.password, {
			eventSubscriptions: OBS_EVENT_SUBSCRIPTIONS
		});
		const timeoutError = new ObsConnectionError('OBS_UNAVAILABLE', 'Timed out connecting to OBS.');
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(timeoutError), CONNECT_TIMEOUT_MS);
		});

		try {
			const { obsWebSocketVersion, negotiatedRpcVersion } = await Promise.race([attempt, timeout]);
			this.#sessionActive = true;
			this.#lastError = null;
			this.#notifyStatus();
			console.info(
				`[obs] Connected to ${url} (obs-websocket ${obsWebSocketVersion}, RPC ${negotiatedRpcVersion})`
			);
		} catch (cause) {
			if (cause === timeoutError) {
				// Close the abandoned socket. The attempt rejects once it has closed, which can take
				// up to 30 s if OBS completed the WebSocket handshake but stopped responding.
				this.#abandoned = attempt
					.catch(() => {})
					.then(() => {
						this.#abandoned = null;
					});
				this.#client.disconnect().catch(() => {});
			}
			const error = toConnectionError(cause);
			this.#lastError = error.code;
			console.warn(`[obs] Could not connect to ${url}: ${describeCause(cause)}`);
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	#handleClosed(error: OBSWebSocketError): void {
		// Also emitted for failed attempts (reported by `#open`) and deliberate disconnects.
		if (!this.#sessionActive) {
			return;
		}
		this.#sessionActive = false;
		this.#lastError = closeCodeToErrorCode(error.code);
		this.#notifyStatus();
		console.warn(`[obs] Connection closed: ${describeCause(error)}`);
	}

	#notifyStatus(): void {
		const status = this.status;
		for (const listener of this.#statusListeners) {
			listener(status);
		}
	}
}

function closeCodeToErrorCode(code: number): ObsConnectionErrorCode {
	return code === AUTHENTICATION_FAILED ? 'OBS_AUTH_FAILED' : 'OBS_UNAVAILABLE';
}

function isWebSocketCloseError(cause: unknown): boolean {
	return cause instanceof OBSWebSocketError && cause.code >= 1000;
}

function toConnectionError(cause: unknown): ObsConnectionError {
	if (cause instanceof ObsConnectionError) {
		return cause;
	}
	if (
		cause instanceof OBSWebSocketError &&
		closeCodeToErrorCode(cause.code) === 'OBS_AUTH_FAILED'
	) {
		return new ObsConnectionError('OBS_AUTH_FAILED', 'OBS rejected the WebSocket password.', {
			cause
		});
	}
	return new ObsConnectionError('OBS_UNAVAILABLE', 'Could not connect to OBS.', { cause });
}

/** Server-log detail. obs-websocket-js messages contain close reasons, never the password. */
export function describeCause(cause: unknown): string {
	if (cause instanceof OBSWebSocketError) {
		return `code ${cause.code}${cause.message ? ` (${cause.message})` : ''}`;
	}
	return cause instanceof Error ? cause.message : String(cause);
}

const globalForObs = globalThis as typeof globalThis & { __obsConnection?: ObsConnection };

/**
 * The process-wide connection, created on first use. Stored on `globalThis` so that Vite
 * re-evaluating this module during development doesn't create a second client.
 */
export function getObsConnection(): ObsConnection {
	globalForObs.__obsConnection ??= new ObsConnection({
		host: OBS_HOST,
		port: OBS_PORT,
		password: OBS_PASSWORD
	});
	return globalForObs.__obsConnection;
}
