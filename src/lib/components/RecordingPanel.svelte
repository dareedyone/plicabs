<script lang="ts">
	import { recordingButtons } from '#lib/dashboard/controls.js';
	import {
		formatElapsed,
		isLiveClock,
		liveDurationMs,
		retainedStopDurationMs
	} from '#lib/dashboard/elapsed.js';
	import {
		messageOf,
		startRecording,
		stopRecording,
		type RecordingStatus
	} from '#lib/dashboard/api.js';

	let {
		recording,
		loading,
		error,
		onrecording,
		onaction
	}: {
		recording: RecordingStatus | null;
		loading: boolean;
		error: string | null;
		onrecording: (status: RecordingStatus) => void;
		onaction?: () => void;
	} = $props();

	let busy = $state<'start' | 'stop' | null>(null);
	let actionError = $state<string | null>(null);
	let lastValidMs = $state(0);
	let since = $state(0);
	let now = $state(0);

	$effect(() => {
		if (!isLiveClock(recording)) {
			return;
		}
		const snapshot = recording.durationMs;
		since = Date.now();
		now = since;
		void snapshot;
		const id = setInterval(() => {
			now = Date.now();
		}, 250);
		return () => clearInterval(id);
	});

	const liveMs = $derived(
		isLiveClock(recording)
			? liveDurationMs(recording.durationMs, since, now)
			: (recording?.durationMs ?? 0)
	);

	$effect(() => {
		if (!recording) {
			return;
		}
		if (recording.active) {
			const ms = isLiveClock(recording) ? liveMs : recording.durationMs;
			lastValidMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
			return;
		}
		if (Number.isFinite(recording.durationMs) && recording.durationMs > 0) {
			lastValidMs = recording.durationMs;
		}
	});

	const shownMs = $derived(
		recording?.active ? liveMs : retainedStopDurationMs(recording?.durationMs ?? 0, lastValidMs)
	);
	const buttons = $derived(recordingButtons(recording, loading, busy));
	const recBadgeClass = $derived(
		recording?.active ? 'bg-red-500/15 text-red-300' : 'bg-zinc-800 text-zinc-400'
	);
	const recDotClass = $derived(
		recording?.active ? 'bg-red-400 motion-safe:animate-pulse' : 'bg-zinc-500'
	);

	async function run(action: 'start' | 'stop') {
		if (busy) return;
		busy = action;
		actionError = null;
		try {
			const next = action === 'start' ? await startRecording() : await stopRecording();
			onrecording(next);
			onaction?.();
		} catch (cause) {
			actionError = messageOf(cause);
		} finally {
			busy = null;
		}
	}
</script>

<section
	class="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl shadow-black/20"
	aria-labelledby="recording-heading"
>
	<div class="flex items-start justify-between gap-3">
		<div>
			<h2 id="recording-heading" class="text-sm font-medium tracking-wide text-zinc-400 uppercase">
				Recording
			</h2>
			<p class="mt-1 text-lg font-semibold text-zinc-50">
				{#if loading && !recording}
					Loading status
				{:else if recording?.active}
					Recording{recording.paused ? ' · paused' : ''}
				{:else}
					Not recording
				{/if}
			</p>
		</div>
		<p
			class="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide {recBadgeClass}"
			aria-live="polite"
		>
			<span class="size-2 rounded-full {recDotClass}" aria-hidden="true"></span>
			{recording?.active ? 'REC' : 'IDLE'}
		</p>
	</div>

	<p
		class="mt-6 font-mono text-4xl leading-none font-semibold tracking-tight text-zinc-50 tabular-nums sm:text-5xl"
	>
		<time datetime={formatElapsed(shownMs)}>{formatElapsed(shownMs)}</time>
	</p>
	<p class="mt-2 text-sm text-zinc-400">Elapsed time</p>

	<p class="mt-5 text-sm">
		<span class="text-zinc-500">File</span>
		<span class="mt-1 block truncate font-medium text-zinc-200">
			{recording?.fileName ?? 'Not available yet'}
		</span>
	</p>

	{#if error || actionError}
		<p class="mt-4 text-sm text-amber-200" role="alert">{actionError ?? error}</p>
	{/if}

	<div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
		<button
			type="button"
			class="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
			disabled={buttons.startDisabled}
			aria-busy={busy === 'start'}
			onclick={() => run('start')}
		>
			{busy === 'start' ? 'Starting…' : 'Start Recording'}
		</button>
		<button
			type="button"
			class="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:text-zinc-500"
			disabled={buttons.stopDisabled}
			aria-busy={busy === 'stop'}
			onclick={() => run('stop')}
		>
			{busy === 'stop' ? 'Stopping…' : 'Stop Recording'}
		</button>
	</div>
</section>
