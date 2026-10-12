<script lang="ts">
	import { onMount } from 'svelte';
	import ConnectionHeader from '#lib/components/ConnectionHeader.svelte';
	import RecordingPanel from '#lib/components/RecordingPanel.svelte';
	import ScenePanel from '#lib/components/ScenePanel.svelte';
	import {
		getConnectionStatus,
		getRecordingStatus,
		getScenes,
		messageOf,
		type ConnectionStatus,
		type RecordingStatus,
		type SceneList
	} from '#lib/dashboard/api.js';
	import {
		applyHubEvent,
		applySnapshot,
		parseSseData,
		type DashboardSnapshot
	} from '#lib/dashboard/sse.js';

	let status = $state<ConnectionStatus | null>(null);
	let statusLoading = $state(true);
	let statusError = $state<string | null>(null);

	let recording = $state<RecordingStatus | null>(null);
	let recordingLoading = $state(true);
	let recordingError = $state<string | null>(null);

	let scenes = $state<SceneList | null>(null);
	let scenesLoading = $state(true);
	let scenesError = $state<string | null>(null);
	/** Bumped on every SSE apply so in-flight HTTP GETs cannot overwrite newer stream state. */
	let streamEpoch = 0;

	async function loadStatus() {
		const epoch = streamEpoch;
		statusLoading = true;
		try {
			const next = await getConnectionStatus();
			if (epoch !== streamEpoch) return;
			status = next;
			statusError = null;
		} catch (cause) {
			if (epoch !== streamEpoch) return;
			statusError = messageOf(cause);
		} finally {
			if (epoch === streamEpoch) statusLoading = false;
		}
	}

	async function loadRecording() {
		const epoch = streamEpoch;
		recordingLoading = true;
		try {
			const next = await getRecordingStatus();
			if (epoch !== streamEpoch) return;
			recording = next;
			recordingError = null;
		} catch (cause) {
			if (epoch !== streamEpoch) return;
			recordingError = messageOf(cause);
		} finally {
			if (epoch === streamEpoch) recordingLoading = false;
		}
	}

	async function loadScenes() {
		const epoch = streamEpoch;
		scenesLoading = true;
		try {
			const next = await getScenes();
			if (epoch !== streamEpoch) return;
			scenes = next;
			scenesError = null;
		} catch (cause) {
			if (epoch !== streamEpoch) return;
			scenesError = messageOf(cause);
		} finally {
			if (epoch === streamEpoch) scenesLoading = false;
		}
	}

	function apply(next: {
		status: typeof status;
		recording: typeof recording;
		scenes: typeof scenes;
	}) {
		streamEpoch += 1;
		status = next.status;
		recording = next.recording;
		scenes = next.scenes;
		if (next.status) {
			statusError = null;
			statusLoading = false;
		}
		if (next.recording) {
			recordingError = null;
			recordingLoading = false;
		}
		if (next.scenes) {
			scenesError = null;
			scenesLoading = false;
		}
	}

	onMount(() => {
		void loadStatus();
		void loadRecording();
		void loadScenes();

		const source = new EventSource('/api/obs/events');
		const current = () => ({ status, recording, scenes });

		source.addEventListener('snapshot', (event: MessageEvent<string>) => {
			const payload = parseSseData<DashboardSnapshot>(event.data);
			if (payload) {
				apply(applySnapshot(current(), payload));
			}
		});
		for (const type of ['connection', 'recording', 'scenes'] as const) {
			source.addEventListener(type, (event: MessageEvent<string>) => {
				apply(applyHubEvent(current(), type, parseSseData(event.data)));
			});
		}

		return () => source.close();
	});
</script>

<svelte:head>
	<title>OBS Control</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-6xl flex-col">
	<ConnectionHeader {status} loading={statusLoading} error={statusError} />

	<main class="grid flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-2">
		<RecordingPanel
			{recording}
			loading={recordingLoading}
			error={recordingError}
			onrecording={(next) => {
				recording = next;
				recordingError = null;
			}}
			onaction={() => void loadStatus()}
		/>
		<ScenePanel
			{scenes}
			loading={scenesLoading}
			error={scenesError}
			onscenes={(next) => {
				scenes = next;
				scenesError = null;
			}}
			onaction={() => void loadStatus()}
		/>
	</main>
</div>
