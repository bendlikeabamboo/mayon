<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Check, ChevronDown, MessageSquare } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		applyProfile,
		DEFAULT_LEVEL,
		DEFAULT_MODE,
		LEVEL_LABELS,
		LEVEL_OPTIONS,
		MODE_LABELS,
		MODE_OPTIONS,
		defaultStrategyFor,
		strategiesForMode,
		type LearningBrief,
		type ScopeStrategyId
	} from '$lib/chat/brief';
	import { getLearnerProfile } from '$lib/chat/profile';

	/**
	 * Learning Brief intake / edit card.
	 *
	 * Three render modes share this component (single source of truth):
	 * - **intake** (default): goal required, two actions — "Start learning"
	 *   (→ `onSave`) and "Just start chatting" (→ `onSkip`). Used by the new-chat
	 *   flow and a fresh root.
	 * - **edit**: a brief exists; opened from the summary chip. No skip action;
	 *   "Done" → `onSave`; optional `onDismiss`.
	 * - The summary chip itself is rendered by the parent (collapsed), not here.
	 *
	 * Local state is seeded from `brief ?? defaults`. The `goal` is bound to a
	 * required `<textarea>`; Submit is disabled until a non-empty trimmed goal
	 * is present. Styling matches existing `border-border bg-card` cards.
	 */
	let {
		brief = null,
		mode = 'intake',
		onSave,
		onSkip,
		onDismiss
	}: {
		brief?: LearningBrief | null;
		mode?: 'intake' | 'edit';
		onSave: (b: LearningBrief) => void | Promise<void>;
		onSkip?: () => void | Promise<void>;
		onDismiss?: () => void | Promise<void>;
	} = $props();

	const isEdit = $derived(mode === 'edit');

	// Seed local state from the brief prop ONCE (the card remounts fresh on each
	// open, so intentional initial-value capture via `untrack` is correct here).
	let goal = $state(untrack(() => brief?.goal ?? ''));
	let context = $state(untrack(() => brief?.context ?? ''));
	let level = $state(untrack(() => brief?.level ?? DEFAULT_LEVEL));
	let scopeState = $state(untrack(() => brief?.scope ?? ''));
	let modeVal = $state(untrack(() => brief?.mode ?? DEFAULT_MODE));
	let scopeStrategy = $state<ScopeStrategyId>(
		untrack(() => brief?.scopeStrategy ?? defaultStrategyFor(DEFAULT_MODE))
	);

	let modeStrategies = $derived(strategiesForMode(modeVal));

	$effect(() => {
		if (!modeStrategies.find((s) => s.id === scopeStrategy)) {
			scopeStrategy = defaultStrategyFor(modeVal);
		}
	});

	onMount(async () => {
		if (mode !== 'intake') return;
		try {
			const profile = await getLearnerProfile();
			const seed = applyProfile(profile, brief ?? {});
			goal = seed.goal ?? '';
			level = seed.level;
			modeVal = seed.mode;
			context = seed.context ?? '';
			scopeState = seed.scope ?? '';
			scopeStrategy = seed.scopeStrategy;
		} catch {
			// Best-effort: fall back to existing defaults
		}
	});

	const canSubmit = $derived(goal.trim().length > 0);

	const inputClass =
		'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
	const labelClass = 'block text-xs font-medium text-muted-foreground';

	function buildBrief(): LearningBrief {
		const b: LearningBrief = { goal: goal.trim(), level, mode: modeVal, scopeStrategy };
		const ctx = context.trim();
		if (ctx.length > 0) b.context = ctx;
		const scp = scopeState.trim();
		if (scp.length > 0) b.scope = scp;
		return b;
	}

	async function submit() {
		if (!canSubmit) return;
		await onSave(buildBrief());
	}

	async function skip() {
		await onSkip?.();
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	}
</script>

<div
	class="space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
	role="dialog"
	aria-label="Learning brief"
>
	<div class="flex items-start justify-between gap-2">
		<div class="space-y-0.5">
			<h2 class="text-base font-semibold">What do you want to be able to do?</h2>
			<p class="text-sm text-muted-foreground">
				{isEdit
					? 'Edit your learning goal. The next reply recalibrates to it.'
					: 'A short brief calibrates the tutor to your goal and level — once, for the whole chat.'}
			</p>
		</div>
		{#if isEdit && onDismiss}
			<button
				type="button"
				class="shrink-0 text-muted-foreground hover:text-foreground"
				title="Close"
				aria-label="Close"
				onclick={onDismiss}
			>
				<ChevronDown class="size-5" />
			</button>
		{/if}
	</div>

	<!-- Goal (required) -->
	<div class="space-y-1">
		<label class={labelClass} for="brief-goal">
			Goal <span class="text-destructive">*</span>
		</label>
		<textarea
			id="brief-goal"
			bind:value={goal}
			onkeydown={onKeydown}
			rows="2"
			placeholder="e.g. “be able to read and write a Makefile”  (⌘/Ctrl+Enter to save)"
			class={inputClass}></textarea>
		<p class="text-xs text-muted-foreground">A doable verb, not a topic noun.</p>
	</div>

	<!-- Level + Mode -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1">
			<label class={labelClass} for="brief-level">Level</label>
			<select id="brief-level" bind:value={level} class={inputClass}>
				{#each LEVEL_OPTIONS as l (l)}
					<option value={l}>{LEVEL_LABELS[l]}</option>
				{/each}
			</select>
		</div>
		<div class="space-y-1">
			<label class={labelClass} for="brief-mode">Teaching mode</label>
			<select id="brief-mode" bind:value={modeVal} class={inputClass}>
				{#each MODE_OPTIONS as m (m)}
					<option value={m}>{MODE_LABELS[m]}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Structure (derived from mode) -->
	<div class="space-y-1">
		<label class={labelClass} for="brief-strategy">Structure</label>
		<select id="brief-strategy" bind:value={scopeStrategy} class={inputClass}>
			{#each modeStrategies as s (s.id)}
				<option value={s.id}>{s.label}</option>
			{/each}
		</select>
		{#if modeStrategies.find((s) => s.id === scopeStrategy)}
			<p class="text-xs text-muted-foreground">
				{modeStrategies.find((s) => s.id === scopeStrategy)?.hint}
			</p>
		{/if}
	</div>

	<!-- Context + Scope (optional) -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1">
			<label class={labelClass} for="brief-context"
				>Context <span class="text-muted-foreground/70">(optional)</span></label
			>
			<input
				id="brief-context"
				bind:value={context}
				placeholder="role / situation"
				class={inputClass}
			/>
		</div>
		<div class="space-y-1">
			<label class={labelClass} for="brief-scope"
				>Scope <span class="text-muted-foreground/70">(optional)</span></label
			>
			<input
				id="brief-scope"
				bind:value={scopeState}
				placeholder="e.g. “orient me in 10 min”"
				class={inputClass}
			/>
		</div>
	</div>

	<div class="flex flex-wrap items-center justify-between gap-2 pt-1">
		{#if !isEdit}
			<Button variant="ghost" size="sm" onclick={skip}>
				<MessageSquare class="size-4" /> Just start chatting →
			</Button>
		{:else}
			<div></div>
		{/if}
		<Button onclick={submit} disabled={!canSubmit}>
			<Check class="size-4" />
			{isEdit ? 'Done' : 'Start learning'}
		</Button>
	</div>
</div>
