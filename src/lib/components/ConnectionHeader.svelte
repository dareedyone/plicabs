<script lang="ts">
	import { connectionErrorMessage, type ConnectionStatus } from '#lib/dashboard/api.js';

	let {
		status,
		loading,
		error
	}: {
		status: ConnectionStatus | null;
		loading: boolean;
		error: string | null;
	} = $props();

	const label = $derived.by(() => {
		if (loading && !status) return 'Checking connection';
		if (!status) return 'Disconnected';
		if (status.state === 'connected') return 'Connected';
		if (status.state === 'connecting') return 'Connecting';
		return 'Disconnected';
	});

	const detail = $derived(error ?? (status ? connectionErrorMessage(status.lastError) : null));
	const tone = $derived.by(() => {
		if (status?.state === 'connected') return 'connected';
		if (status?.state === 'connecting' || (loading && !status)) return 'connecting';
		return 'disconnected';
	});
	const badgeClass = $derived(
		tone === 'connected'
			? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'
			: tone === 'connecting'
				? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
				: 'border-zinc-700 bg-zinc-900 text-zinc-300'
	);
	const dotClass = $derived(
		tone === 'connected'
			? 'bg-emerald-400'
			: tone === 'connecting'
				? 'bg-amber-300 motion-safe:animate-pulse'
				: 'bg-zinc-500'
	);
</script>

<header
	class="flex flex-col gap-3 border-b border-zinc-800/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
>
	<div>
		<p class="text-[11px] font-medium tracking-[0.22em] text-zinc-500 uppercase">Cuez</p>
		<h1 class="text-xl font-semibold tracking-tight text-zinc-50">OBS Control</h1>
	</div>

	<div class="flex flex-col items-start gap-1 sm:items-end">
		<p
			class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm {badgeClass}"
			aria-live="polite"
		>
			<span class="size-2 rounded-full {dotClass}" aria-hidden="true"></span>
			<span>{label}</span>
		</p>
		{#if detail}
			<p class="max-w-md text-xs text-zinc-400 sm:text-right" role="status">{detail}</p>
		{/if}
	</div>
</header>
