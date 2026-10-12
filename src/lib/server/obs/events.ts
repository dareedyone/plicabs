import type { OBSEventTypes } from 'obs-websocket-js';
import { getObsConnection, type ObsConnectionStatus } from './connection';
import {
	getLiveRecordingStatus,
	onRecordingBecameActive,
	rememberRecordingFile,
	type RecordingStatus
} from './recording';
import { getScenes, type SceneList } from './scenes';

export const RECORDING_POLL_MS = 1_000;
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000] as const;

export type ObsHubEvent =
	| { type: 'connection'; data: ObsConnectionStatus }
	| { type: 'recording'; data: RecordingStatus }
	| { type: 'scenes'; data: SceneList };

export interface ObsSnapshot {
	connection: ObsConnectionStatus;
	recording: RecordingStatus | null;
	scenes: SceneList | null;
}

export interface ObsHubConnection {
	readonly status: ObsConnectionStatus;
	isConnected(): boolean;
	connect(): Promise<void>;
	onStatus(listener: (status: ObsConnectionStatus) => void): () => void;
	onObsEvent<K extends keyof OBSEventTypes>(
		event: K,
		handler: (payload: OBSEventTypes[K]) => void
	): () => void;
}

export interface ObsEventHubDeps {
	connection: ObsHubConnection;
	readRecording: () => Promise<RecordingStatus>;
	readScenes: () => Promise<SceneList>;
}

/**
 * One in-process fan-out: a single OBS connection's events are normalized and
 * copied to every SSE subscriber. This hub owns reconnect and duration polling.
 */
export class ObsEventHub {
	readonly #deps: ObsEventHubDeps;
	readonly #listeners = new Set<(event: ObsHubEvent) => void>();
	#attached = false;
	#reconnectEnabled = false;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	#backoffIndex = 0;
	#refreshing: Promise<void> | null = null;
	#lastStatus: ObsConnectionStatus | null = null;
	#lastRecording: RecordingStatus | null = null;
	#lastScenes: SceneList | null = null;

	constructor(deps: ObsEventHubDeps) {
		this.#deps = deps;
	}

	get subscriberCount(): number {
		return this.#listeners.size;
	}

	subscribe(listener: (event: ObsHubEvent) => void): () => void {
		this.#listeners.add(listener);
		this.#attach();
		this.#reconnectEnabled = true;
		void this.#connectAndRefresh();
		return () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0) {
				this.#reconnectEnabled = false;
				this.#clearReconnect();
				this.#stopPoll();
			}
		};
	}

	async snapshot(): Promise<ObsSnapshot> {
		this.#attach();
		await this.#connectAndRefresh();
		return {
			connection: this.#deps.connection.status,
			recording: this.#lastRecording,
			scenes: this.#lastScenes
		};
	}

	#attach(): void {
		if (this.#attached) {
			return;
		}
		this.#attached = true;
		const { connection } = this.#deps;
		connection.onStatus((status) => this.#onStatus(status));
		connection.onObsEvent('RecordStateChanged', (payload) => this.#onRecordState(payload));
		connection.onObsEvent('RecordFileChanged', (payload) => this.#onRecordFile(payload));
		connection.onObsEvent('CurrentProgramSceneChanged', () => {
			void this.#refreshScenes();
		});
		connection.onObsEvent('SceneListChanged', () => {
			void this.#refreshScenes();
		});
		connection.onObsEvent('SceneCreated', () => {
			void this.#refreshScenes();
		});
		connection.onObsEvent('SceneRemoved', () => {
			void this.#refreshScenes();
		});
		connection.onObsEvent('SceneNameChanged', () => {
			void this.#refreshScenes();
		});
	}

	#onStatus(status: ObsConnectionStatus): void {
		const previous = this.#lastStatus;
		this.#lastStatus = status;
		if (previous && previous.state === status.state && previous.lastError === status.lastError) {
			return;
		}
		this.#emit({ type: 'connection', data: status });
		if (status.state === 'connected') {
			this.#backoffIndex = 0;
			this.#clearReconnect();
			void this.#refreshRecording();
			void this.#refreshScenes();
			return;
		}
		if (status.state === 'disconnected') {
			this.#stopPoll();
			this.#scheduleReconnect();
		}
	}

	#onRecordState(payload: OBSEventTypes['RecordStateChanged']): void {
		if (payload.outputActive) {
			onRecordingBecameActive();
		} else {
			rememberRecordingFile(payload.outputPath, false);
		}
		void this.#refreshRecording();
	}

	#onRecordFile(payload: OBSEventTypes['RecordFileChanged']): void {
		rememberRecordingFile(payload.newOutputPath, true);
		void this.#refreshRecording();
	}

	#connectAndRefresh(): Promise<void> {
		this.#refreshing ??= this.#doConnectAndRefresh().finally(() => {
			this.#refreshing = null;
		});
		return this.#refreshing;
	}

	async #doConnectAndRefresh(): Promise<void> {
		try {
			await this.#deps.connection.connect();
			this.#backoffIndex = 0;
			await Promise.all([this.#refreshRecording(), this.#refreshScenes()]);
		} catch {
			this.#emit({ type: 'connection', data: this.#deps.connection.status });
			this.#scheduleReconnect();
		}
	}

	async #refreshRecording(): Promise<void> {
		try {
			this.#lastRecording = await this.#deps.readRecording();
			this.#emit({ type: 'recording', data: this.#lastRecording });
			this.#syncPoll();
		} catch {
			this.#syncPoll();
		}
	}

	async #refreshScenes(): Promise<void> {
		try {
			this.#lastScenes = await this.#deps.readScenes();
			this.#emit({ type: 'scenes', data: this.#lastScenes });
		} catch {
			// A drop is surfaced through connection status and reconnect.
		}
	}

	#syncPoll(): void {
		const shouldPoll =
			this.#listeners.size > 0 &&
			this.#lastRecording?.active === true &&
			this.#deps.connection.isConnected();
		if (shouldPoll) {
			this.#pollTimer ??= setInterval(() => {
				void this.#refreshRecording();
			}, RECORDING_POLL_MS);
			return;
		}
		this.#stopPoll();
	}

	#scheduleReconnect(): void {
		if (!this.#reconnectEnabled) {
			return;
		}
		if (this.#deps.connection.status.lastError === 'OBS_AUTH_FAILED') {
			return;
		}
		if (
			this.#deps.connection.isConnected() ||
			this.#deps.connection.status.state === 'connecting'
		) {
			return;
		}
		if (this.#reconnectTimer) {
			return;
		}
		const delay =
			RECONNECT_BACKOFF_MS[Math.min(this.#backoffIndex, RECONNECT_BACKOFF_MS.length - 1)];
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			if (this.#backoffIndex < RECONNECT_BACKOFF_MS.length - 1) {
				this.#backoffIndex += 1;
			}
			void this.#connectAndRefresh();
		}, delay);
	}

	#clearReconnect(): void {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	#stopPoll(): void {
		if (this.#pollTimer) {
			clearInterval(this.#pollTimer);
			this.#pollTimer = null;
		}
	}

	#emit(event: ObsHubEvent): void {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function defaultDeps(): ObsEventHubDeps {
	return {
		connection: getObsConnection(),
		readRecording: getLiveRecordingStatus,
		readScenes: getScenes
	};
}

const globalForHub = globalThis as typeof globalThis & { __obsEventHub?: ObsEventHub };

export function getObsEventHub(): ObsEventHub {
	globalForHub.__obsEventHub ??= new ObsEventHub(defaultDeps());
	return globalForHub.__obsEventHub;
}
