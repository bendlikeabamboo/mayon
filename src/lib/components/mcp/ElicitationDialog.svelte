<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog/index.js';
	import type { PublicElicitationEntry } from '$lib/stores/chat.svelte';

	type Props = {
		entry: PublicElicitationEntry;
		onSubmit: (data: Record<string, unknown>) => void;
		onCancel: () => void;
	};

	let { entry, onSubmit, onCancel }: Props = $props();

	interface FieldDef {
		name: string;
		type: string;
		title?: string;
		description?: string;
	}

	let fields = $derived<FieldDef[]>(computeFields(entry.schema));

	function computeFields(schema: Record<string, unknown>): FieldDef[] {
		if (!schema || typeof schema !== 'object') return [];
		const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
		if (!props) return [];
		return Object.entries(props).map(([name, def]) => ({
			name,
			type: (def.type as string) ?? 'string',
			title: (def.title as string) ?? name,
			description: (def.description as string) ?? ''
		}));
	}

	let useJsonFallback = $state(false);
	let formData = $state<Record<string, unknown>>({});
	let jsonText = $state('{}');
	let jsonError = $state<string | null>(null);
	const placeholderText = '{}';

	function handleSubmit(): void {
		if (useJsonFallback) {
			try {
				const parsed = JSON.parse(jsonText);
				jsonError = null;
				onSubmit(parsed);
			} catch (err) {
				jsonError = err instanceof Error ? err.message : 'Invalid JSON';
			}
			return;
		}
		onSubmit(formData);
	}
</script>

<Dialog open>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Server Input Request</DialogTitle>
			<DialogDescription>
				{entry.serverName}: {entry.message}
			</DialogDescription>
		</DialogHeader>

		{#if !useJsonFallback && fields.length > 0}
			<div class="space-y-3 py-2">
				{#each fields as field (field.name)}
					<div>
						<label class="text-sm font-medium" for="field-{field.name}">
							{field.title}
							{#if field.description}
								<span class="ml-1 text-xs text-muted-foreground">({field.description})</span>
							{/if}
						</label>
						{#if field.type === 'boolean'}
							<input
								type="checkbox"
								id="field-{field.name}"
								bind:checked={formData[field.name] as boolean}
								class="mt-1"
							/>
						{:else if field.type === 'number'}
							<input
								type="number"
								id="field-{field.name}"
								bind:value={formData[field.name] as number}
								class="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
							/>
						{:else}
							<input
								type="text"
								id="field-{field.name}"
								bind:value={formData[field.name] as string}
								class="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
							/>
						{/if}
					</div>
				{/each}
			</div>
			<button
				class="text-xs text-muted-foreground underline"
				onclick={() => (useJsonFallback = true)}
			>
				Switch to JSON input
			</button>
		{:else}
			<div class="py-2">
				<textarea
					bind:value={jsonText}
					rows="6"
					class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm"
					placeholder={placeholderText}></textarea>
				{#if jsonError}
					<p class="mt-1 text-xs text-destructive">{jsonError}</p>
				{/if}
			</div>
			{#if fields.length > 0}
				<button
					class="text-xs text-muted-foreground underline"
					onclick={() => (useJsonFallback = false)}
				>
					Switch to form input
				</button>
			{/if}
		{/if}

		<DialogFooter>
			<Button variant="outline" size="sm" onclick={onCancel}>Cancel</Button>
			<Button variant="default" size="sm" onclick={handleSubmit}>Submit</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
