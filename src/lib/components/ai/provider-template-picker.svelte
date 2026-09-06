<script lang="ts">
	import { PROVIDER_TEMPLATES, type ProviderTemplate } from '$lib/ai/registry';
	import { Button } from '$lib/components/ui/button/index.js';

	let { onselect }: { onselect: (template: ProviderTemplate) => void } = $props();

	let query = $state('');

	const GROUPS = [
		{
			id: 'local',
			label: 'Local',
			description: 'Run models on your own machine. No API key required.'
		},
		{
			id: 'cloud',
			label: 'Cloud APIs',
			description: 'Hosted model APIs. Requires an API key.'
		},
		{
			id: 'gateway',
			label: 'Gateways',
			description: 'Routers that broker many providers behind one endpoint.'
		},
		{
			id: 'custom',
			label: 'Custom',
			description: 'Your own OpenAI-compatible endpoint.'
		}
	] as const;

	let searching = $derived(query.trim() !== '');
	let needle = $derived(query.trim().toLowerCase());
	// FR-004: search matches provider names only, across all groups.
	let visibleGroups = $derived(
		GROUPS.map((group) => ({
			...group,
			templates: PROVIDER_TEMPLATES.filter(
				(t) => t.group === group.id && (!searching || t.label.toLowerCase().includes(needle))
			)
		})).filter((group) => !searching || group.templates.length > 0)
	);
</script>

<input
	class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
	placeholder="Search providers…"
	aria-label="Search providers"
	value={query}
	oninput={(e) => (query = e.currentTarget.value)}
/>

{#if searching && visibleGroups.length === 0}
	<div class="flex items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">No providers match '{query}'.</p>
		<Button variant="outline" size="sm" onclick={() => (query = '')}>Clear search</Button>
	</div>
{:else}
	{#each visibleGroups as group (group.id)}
		<section class="space-y-2">
			<div>
				<h3 class="text-sm font-semibold">{group.label}</h3>
				<p class="text-xs text-muted-foreground">{group.description}</p>
			</div>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each group.templates as t (t.label)}
					<button
						type="button"
						class="rounded-md border border-input bg-background p-3 text-left text-sm transition-colors hover:bg-accent"
						onclick={() => onselect(t)}
					>
						<span class="flex items-center gap-2 font-medium">
							{t.label}
							{#if !t.requiresKey}
								<span
									class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
								>
									no key required
								</span>
							{/if}
						</span>
						<span class="block text-xs text-muted-foreground">{t.description}</span>
					</button>
				{/each}
			</div>
		</section>
	{/each}
{/if}
