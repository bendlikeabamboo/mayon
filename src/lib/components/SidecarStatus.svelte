<script lang="ts">
	import { CheckCircle2, Unplug } from '@lucide/svelte';
	import { sidecarStatus } from '$lib/sidecar/status.svelte.js';
	import { cn } from '$lib/utils.js';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	const label = $derived(
		sidecarStatus.connected
			? sidecarStatus.version
				? `Sidecar: v${sidecarStatus.version}`
				: 'Sidecar: connected'
			: 'Sidecar: off'
	);

	const title = $derived(
		sidecarStatus.connected
			? `Mayon sidecar capabilities: ${sidecarStatus.caps.join(', ') || 'none yet'}`
			: 'Browser-only (run `docker compose up` for the sidecar)'
	);

	const badgeClass = $derived(
		cn(
			'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
			collapsed && 'gap-0 px-0 py-1',
			sidecarStatus.connected && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
			!sidecarStatus.connected && 'bg-muted text-muted-foreground'
		)
	);
</script>

<div class={badgeClass} {title}>
	{#if sidecarStatus.connected}
		<CheckCircle2 class="size-3.5" />
	{:else}
		<Unplug class="size-3.5" />
	{/if}
	{#if !collapsed}
		<span>{label}</span>
	{/if}
</div>
