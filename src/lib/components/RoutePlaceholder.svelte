<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, description, children }: { title: string; description: string; children?: Snippet } =
		$props();
</script>

<svelte:head>
	<title>{title} — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-4 p-8">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
		<p class="text-sm text-muted-foreground">{description}</p>
	</div>
	{#if children}
		<div class="rounded-lg border border-dashed border-border p-6">
			{@render children()}
		</div>
	{/if}
</div>
