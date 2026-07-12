<script lang="ts">
	import { Monitor, Moon, Sun } from '@lucide/svelte';
	import { themeState, type Theme } from '$lib/stores/theme.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	const cycle: Theme[] = ['light', 'dark', 'system'];

	const icon = $derived(
		themeState.preference === 'light' ? Sun : themeState.preference === 'dark' ? Moon : Monitor
	);
	const name = $derived(
		themeState.preference === 'light'
			? 'Light'
			: themeState.preference === 'dark'
				? 'Dark'
				: 'System'
	);
	const label = $derived(`Theme: ${themeState.preference} (click to switch)`);

	function toggle() {
		const next = cycle[(cycle.indexOf(themeState.preference) + 1) % cycle.length];
		themeState.set(next);
	}
</script>

<Button
	variant="ghost"
	size="sm"
	class={collapsed ? 'w-full justify-start gap-0' : 'w-full justify-start gap-2'}
	title={label}
	aria-label={label}
	onclick={toggle}
>
	{#if icon === Sun}
		<Sun class="relative z-10 size-4 shrink-0" />
	{:else if icon === Moon}
		<Moon class="relative z-10 size-4 shrink-0" />
	{:else}
		<Monitor class="relative z-10 size-4 shrink-0" />
	{/if}
	<span
		class="overflow-hidden whitespace-nowrap transition-all duration-200 ease-out"
		class:max-w-0={collapsed}
		class:opacity-0={collapsed}
		class:-translate-x-2={collapsed}
		class:max-w-[10rem]={!collapsed}
		class:opacity-100={!collapsed}
		class:translate-x-0={!collapsed}
	>
		{name}
	</span>
</Button>
