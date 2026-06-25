<script lang="ts">
	import { Monitor, Moon, Sun } from '@lucide/svelte';
	import { themeState, type Theme } from '$lib/stores/theme.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';

	const cycle: Theme[] = ['light', 'dark', 'system'];

	const icon = $derived(
		themeState.preference === 'light' ? Sun : themeState.preference === 'dark' ? Moon : Monitor
	);
	const label = $derived(`Theme: ${themeState.preference} (click to switch)`);

	function toggle() {
		const next = cycle[(cycle.indexOf(themeState.preference) + 1) % cycle.length];
		themeState.set(next);
	}
</script>

<Button variant="ghost" size="icon" title={label} aria-label={label} onclick={toggle}>
	{#if icon === Sun}<Sun />{:else if icon === Moon}<Moon />{:else}<Monitor />{/if}
</Button>
