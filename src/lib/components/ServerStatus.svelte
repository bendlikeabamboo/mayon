<script lang="ts">
	import { CheckCircle2, Unplug } from '@lucide/svelte';
	import { serverStatus } from '$lib/services/status.svelte.js';
	import { cn } from '$lib/utils.js';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	const label = $derived(
		serverStatus.connected
			? serverStatus.version
				? `Server: v${serverStatus.version}`
				: 'Server: connected'
			: 'Server: off'
	);

	const title = $derived(
		serverStatus.connected
			? `Mayon server capabilities: ${serverStatus.caps.join(', ') || 'none yet'}`
			: 'Browser-only (run `docker compose up` for the server)'
	);

	const badgeColor = $derived(
		cn(
			serverStatus.connected && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
			!serverStatus.connected && 'bg-muted text-muted-foreground'
		)
	);
</script>

<div class="flex w-full items-center">
	<div
		class={cn(
			'flex items-center rounded-md py-1 text-xs font-medium transition-all duration-200 ease-out grow justify-start px-3',
			collapsed ? 'gap-0' : 'gap-1.5',
			badgeColor
		)}
		{title}
	>
		{#if serverStatus.connected}
			<span class="relative z-10 grid size-4 shrink-0 place-items-center">
				<CheckCircle2 class="size-3.5" />
			</span>
		{:else}
			<span class="relative z-10 grid size-4 shrink-0 place-items-center">
				<Unplug class="size-3.5" />
			</span>
		{/if}
		<span
			class="min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out"
			class:max-w-0={collapsed}
			class:opacity-0={collapsed}
			class:-translate-x-1.5={collapsed}
			class:max-w-60={!collapsed}
			class:opacity-100={!collapsed}
			class:translate-x-0={!collapsed}
		>
			{label}
		</span>
	</div>
</div>
