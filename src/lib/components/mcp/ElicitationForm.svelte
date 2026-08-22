<script lang="ts">
	type ElicitField = {
		name: string;
		type: string;
		title?: string;
		description?: string;
	};

	export type { ElicitField };

	export function computeFields(schema: Record<string, unknown>): ElicitField[] {
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

	let {
		schema,
		fieldPrefix = 'field',
		formData = $bindable({}),
		useJsonFallback = $bindable(false),
		jsonText = $bindable('{}'),
		jsonError = $bindable(null)
	}: {
		schema: Record<string, unknown>;
		fieldPrefix?: string;
		formData?: Record<string, unknown>;
		useJsonFallback?: boolean;
		jsonText?: string;
		jsonError?: string | null;
	} = $props();

	let fields = $derived(computeFields(schema));
</script>

{#if !useJsonFallback && fields.length > 0}
	<div class="space-y-3 py-2">
		{#each fields as field (field.name)}
			<div>
				<label class="text-sm font-medium" for="{fieldPrefix}-{field.name}">
					{field.title}
					{#if field.description}
						<span class="ml-1 text-xs text-muted-foreground">({field.description})</span>
					{/if}
				</label>
				{#if field.type === 'boolean'}
					<input
						type="checkbox"
						id="{fieldPrefix}-{field.name}"
						bind:checked={formData[field.name] as boolean}
						class="mt-1"
					/>
				{:else if field.type === 'number'}
					<input
						type="number"
						id="{fieldPrefix}-{field.name}"
						bind:value={formData[field.name] as number}
						class="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
					/>
				{:else}
					<input
						type="text"
						id="{fieldPrefix}-{field.name}"
						bind:value={formData[field.name] as string}
						class="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
					/>
				{/if}
			</div>
		{/each}
	</div>
	<button class="text-xs text-muted-foreground underline" onclick={() => (useJsonFallback = true)}>
		Switch to JSON input
	</button>
{:else}
	<div class="py-2">
		<textarea
			bind:value={jsonText}
			rows="6"
			class="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm"
			placeholder={'{}'}></textarea>
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
