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

	let status = $state<ConnectionStatus | null>(null);
	let statusLoading = $state(true);
	let statusError = $state<string | null>(null);

	let recording = $state<RecordingStatus | null>(null);
	let recordingLoading = $state(true);
	let recordingError = $state<string | null>(null);

	let scenes = $state<SceneList | null>(null);
	let scenesLoading = $state(true);
	let scenesError = $state<string | null>(null);

	async function loadStatus() {
		statusLoading = true;
		try {
			status = await getConnectionStatus();
			statusError = null;
		} catch (cause) {
			statusError = messageOf(cause);
		} finally {
			statusLoading = false;
		}
	}

	async function loadRecording() {
		recordingLoading = true;
		try {
			recording = await getRecordingStatus();
			recordingError = null;
		} catch (cause) {
			recordingError = messageOf(cause);
		} finally {
			recordingLoading = false;
		}
	}

	async function loadScenes() {
		scenesLoading = true;
		try {
			scenes = await getScenes();
			scenesError = null;
		} catch (cause) {
			scenesError = messageOf(cause);
		} finally {
			scenesLoading = false;
		}
	}

	onMount(() => {
		void loadStatus();
		void loadRecording();
		void loadScenes();
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
