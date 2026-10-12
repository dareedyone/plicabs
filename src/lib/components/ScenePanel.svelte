<script lang="ts">
	import { canSwitchTo } from '#lib/dashboard/controls.js';
	import { messageOf, switchScene, type SceneList } from '#lib/dashboard/api.js';

	let {
		scenes,
		loading,
		error,
		onscenes,
		onaction
	}: {
		scenes: SceneList | null;
		loading: boolean;
		error: string | null;
		onscenes: (list: SceneList) => void;
		onaction?: () => void;
	} = $props();

	let busyName = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	const names = $derived(scenes?.scenes ?? []);
	const current = $derived(scenes?.currentScene ?? null);

	async function select(sceneName: string) {
		if (!canSwitchTo(scenes, sceneName, busyName !== null)) return;
		busyName = sceneName;
		actionError = null;
		try {
			onscenes(await switchScene(sceneName));
			onaction?.();
		} catch (cause) {
			actionError = messageOf(cause);
		} finally {
			busyName = null;
		}
	}
</script>

<section
	class="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl shadow-black/20"
	aria-labelledby="scenes-heading"
>
	<div>
		<h2 id="scenes-heading" class="text-sm font-medium tracking-wide text-zinc-400 uppercase">
			Scenes
		</h2>
		<p class="mt-1 text-lg font-semibold text-zinc-50">
			{#if loading && !scenes}
				Loading scenes
			{:else if current}
				On air: {current}
			{:else}
				No program scene
			{/if}
		</p>
	</div>

	{#if error || actionError}
		<p class="mt-4 text-sm text-amber-200" role="alert">{actionError ?? error}</p>
	{/if}

	{#if loading && !scenes}
		<p class="mt-6 text-sm text-zinc-500">Fetching the scene list from OBS…</p>
	{:else if names.length === 0}
		<p class="mt-6 rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-sm text-zinc-400">
			No scenes are available. Add a scene in OBS, then reload this page.
		</p>
	{:else}
		<ul class="mt-5 flex flex-col gap-2" aria-label="OBS scenes">
			{#each names as name (name)}
				<li>
					<button
						type="button"
						class="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-60 {name ===
						current
							? 'border-sky-400/50 bg-sky-500/10 text-sky-100'
							: 'border-zinc-800 bg-zinc-950/60 text-zinc-200 hover:border-zinc-600'}"
						disabled={busyName !== null}
						aria-current={name === current ? 'true' : undefined}
						aria-busy={busyName === name}
						onclick={() => select(name)}
					>
						<span class="truncate font-medium">{name}</span>
						<span class="ml-3 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
							{#if busyName === name}
								Switching
							{:else if name === current}
								Program
							{:else}
								Switch
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
