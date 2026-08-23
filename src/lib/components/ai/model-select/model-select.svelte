<script lang="ts">
	import { ChevronDown, RefreshCw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { filterModels } from './filter-models.svelte';
	import ModelSelectDialog from './model-select-dialog.svelte';
	import ModelSelectInput from './model-select-input.svelte';
	import ModelSelectItem from './model-select-item.svelte';
	import ModelSelectList from './model-select-list.svelte';
	import ModelSelectEmpty from './model-select-empty.svelte';
	import ModelSelectName from './model-select-name.svelte';

	let {
		models,
		value,
		discoverable = false,
		discovering = false,
		onselect,
		onrefresh
	}: {
		models: string[];
		value: string;
		discoverable?: boolean;
		discovering?: boolean;
		onselect?: (model: string) => void;
		onrefresh?: () => void;
	} = $props();

	let open = $state(false);
	let query = $state('');

	$effect(() => {
		if (open) query = '';
	});

	let filtered = $derived(filterModels(models, value, query));
	let isEmptyConfigured = $derived(models.length === 0 && !value);
	let isFilterMiss = $derived(filtered.items.length === 0 && !isEmptyConfigured);

	function handleSelect(modelId: string) {
		onselect?.(modelId);
		open = false;
	}
</script>

<div class="flex items-center gap-2">
	<button
		type="button"
		class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		onclick={() => (open = true)}
		aria-haspopup="dialog"
	>
		<span class="truncate {value ? '' : 'text-muted-foreground'}">
			{value || 'Select a model…'}
		</span>
		<ChevronDown class="size-4 shrink-0 opacity-60" />
	</button>
	{#if discoverable}
		<Button
			variant="outline"
			size="icon"
			class="size-9 shrink-0"
			title="Refresh model list"
			aria-label="Refresh model list"
			disabled={discovering}
			onclick={onrefresh}
		>
			<RefreshCw class="size-4 {discovering ? 'animate-spin' : ''}" />
		</Button>
	{/if}
</div>

<ModelSelectDialog bind:open>
	<ModelSelectInput bind:value={query} placeholder="Search models…" />
	<ModelSelectList>
		{#each filtered.items as model (model)}
			<ModelSelectItem value={model} onselect={() => handleSelect(model)}>
				<ModelSelectName>{model}</ModelSelectName>
			</ModelSelectItem>
		{/each}
		<ModelSelectEmpty>
			{#if isEmptyConfigured}
				<div class="px-2 py-3 text-center text-xs text-muted-foreground">
					{#if discoverable}
						No models yet — <button
							type="button"
							class="underline"
							onclick={() => {
								open = false;
								onrefresh?.();
							}}>click refresh</button
						> to discover models.
					{:else}
						No models configured. Add a provider in settings.
					{/if}
				</div>
			{:else if isFilterMiss}
				<div class="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</div>
			{/if}
		</ModelSelectEmpty>
	</ModelSelectList>
</ModelSelectDialog>
