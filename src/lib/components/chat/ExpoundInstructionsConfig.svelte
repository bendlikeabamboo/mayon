<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus, RotateCcw, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog/index.js';
	import { uuid } from '$lib/db/ids';
	import {
		DEFAULT_EXPOUND_INSTRUCTIONS,
		getExpoundInstructions,
		saveExpoundInstructions,
		validateInstruction,
		type ExpoundInstruction
	} from '$lib/chat/expound-instructions';

	let instructions = $state<ExpoundInstruction[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let status = $state<string | null>(null);
	let errors = $state<Record<string, string>>({});
	let confirmingRestore = $state(false);

	const inputClass =
		'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

	onMount(async () => {
		try {
			instructions = await getExpoundInstructions();
		} catch {
			instructions = DEFAULT_EXPOUND_INSTRUCTIONS.map((i) => ({ ...i }));
		}
		loading = false;
	});

	function updateEntry(id: string, patch: Partial<ExpoundInstruction>) {
		instructions = instructions.map((e) => (e.id === id ? { ...e, ...patch } : e));
	}

	function onNameInput(id: string, value: string) {
		updateEntry(id, { name: value });
	}

	function onDescriptionInput(id: string, value: string) {
		updateEntry(id, { description: value });
	}

	function addInstruction() {
		instructions = [...instructions, { id: uuid(), name: '' }];
	}

	function removeInstruction(id: string) {
		instructions = instructions.filter((e) => e.id !== id);
		void tryPersist();
	}

	async function restoreDefaults() {
		const fresh = DEFAULT_EXPOUND_INSTRUCTIONS.map((i) => ({ ...i }));
		instructions = fresh;
		errors = {};
		saving = true;
		status = null;
		try {
			await saveExpoundInstructions(fresh);
			status = 'Saved.';
		} catch (err) {
			status = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			saving = false;
		}
		confirmingRestore = false;
	}

	async function tryPersist() {
		const nextErrors: Record<string, string> = {};
		for (const e of instructions) {
			const err = validateInstruction(instructions, e, e.id);
			if (err) nextErrors[e.id] = err;
		}
		errors = nextErrors;
		if (Object.keys(nextErrors).length > 0) {
			status = null;
			return;
		}
		const clean = instructions.map((e) => {
			const item: ExpoundInstruction = { id: e.id, name: e.name.trim() };
			const description = e.description?.trim() ?? '';
			if (description.length > 0) item.description = description;
			if (e.builtin) item.builtin = true;
			return item;
		});
		saving = true;
		status = null;
		try {
			await saveExpoundInstructions(clean);
			instructions = clean;
			status = 'Saved.';
		} catch (err) {
			status = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			saving = false;
		}
	}
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
			Expound Instructions
		</h2>
		<div class="flex items-center gap-1">
			<Button variant="outline" size="sm" onclick={addInstruction} disabled={loading || saving}>
				<Plus class="size-4" /> Add instruction
			</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => (confirmingRestore = true)}
				disabled={loading || saving}
			>
				<RotateCcw class="size-4" /> Restore defaults
			</Button>
		</div>
	</div>

	<p class="text-xs text-muted-foreground">
		Added instructions offered when expounding on a highlight. Selected names are carried into the
		expound request.
	</p>

	{#if status}
		<p class="text-xs text-muted-foreground" role="status">{status}</p>
	{/if}

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if instructions.length === 0}
		<p
			class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
		>
			No expound instructions. Click "Add instruction" to add one.
		</p>
	{:else}
		<ul class="space-y-3">
			{#each instructions as ins (ins.id)}
				<li class="space-y-2 rounded-lg border border-border p-4">
					<div class="flex items-center gap-2">
						<div class="min-w-0 flex-1">
							<input
								class={inputClass}
								value={ins.name}
								oninput={(e) => onNameInput(ins.id, e.currentTarget.value)}
								onchange={() => void tryPersist()}
								placeholder="Instruction name"
								aria-label="Instruction name"
								disabled={saving}
							/>
						</div>
						{#if ins.builtin}
							<Badge variant="secondary">Built-in</Badge>
						{/if}
						<Button
							variant="ghost"
							size="icon"
							class="shrink-0"
							title="Delete instruction"
							aria-label="Delete instruction"
							onclick={() => removeInstruction(ins.id)}
							disabled={saving}
						>
							<Trash2 class="size-4" />
						</Button>
					</div>
					<input
						class={inputClass}
						value={ins.description ?? ''}
						oninput={(e) => onDescriptionInput(ins.id, e.currentTarget.value)}
						onchange={() => void tryPersist()}
						placeholder="Description (optional)"
						aria-label="Instruction description (optional)"
						disabled={saving}
					/>
					{#if errors[ins.id]}
						<p class="text-xs text-red-600 dark:text-red-400" role="alert">
							{errors[ins.id]}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Dialog bind:open={confirmingRestore}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Restore Default Instructions</DialogTitle>
			<DialogDescription>
				This will replace your current list with the five built-in instructions.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" size="sm" onclick={() => (confirmingRestore = false)}>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				onclick={() => void restoreDefaults()}
				disabled={saving}
			>
				Restore
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
