<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { isStripEnabled, setStripEnabled } from '$lib/chat/strip/pref';
	import {
		STREAM_PRESET_OPTIONS,
		STREAM_PRESET_LABELS,
		getStreamPreset,
		setStreamPreset
	} from '$lib/chat/streaming/pref';
	import type { StreamPreset } from '$lib/chat/streaming/pref';

	let stripEnabled = $state(true);
	let streamPreset = $state<StreamPreset>('standard');
	let savedPreset: StreamPreset = 'standard';
	let loading = $state(true);

	onMount(async () => {
		stripEnabled = await isStripEnabled();
		savedPreset = await getStreamPreset();
		streamPreset = savedPreset;
		loading = false;
	});

	async function toggleStrip() {
		const next = !stripEnabled;
		stripEnabled = next;
		try {
			await setStripEnabled(next);
		} catch {
			stripEnabled = !next;
		}
	}

	async function changePreset() {
		const prev = savedPreset;
		const next = streamPreset;
		if (next === prev) return;
		try {
			await setStreamPreset(next);
			savedPreset = next;
		} catch {
			streamPreset = prev;
		}
	}
</script>

<section class="space-y-3">
	<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Chat</h2>

	<p class="text-xs text-muted-foreground">Display options for the conversation transcript.</p>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm">Section strip in long replies</p>
				<p class="text-xs text-muted-foreground">Hover-peek section navigation on long replies.</p>
			</div>
			<Button
				variant={stripEnabled ? 'outline' : 'ghost'}
				size="sm"
				aria-pressed={stripEnabled}
				onclick={toggleStrip}
			>
				{stripEnabled ? 'On' : 'Off'}
			</Button>
		</div>
		<div class="space-y-1">
			<label class="text-sm" for="stream-preset">Streaming look</label>
			<select id="stream-preset" bind:value={streamPreset} onchange={changePreset}>
				{#each STREAM_PRESET_OPTIONS as p (p)}
					<option value={p}>{STREAM_PRESET_LABELS[p]}</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				Calm = steady cadence + caret; Standard = classic streaming; Expressive = cadence + soft
				edge.
			</p>
		</div>
	{/if}
</section>
