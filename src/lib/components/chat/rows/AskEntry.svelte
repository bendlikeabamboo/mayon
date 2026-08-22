<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronRight,
		ChevronDown,
		ShieldCheck,
		ShieldAlert,
		MessageCircleQuestion
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { DurableEntry, LiveAskPayload } from '$lib/chat/entries';
	import {
		parseMetadata,
		type ApprovalMeta,
		type SamplingMeta,
		type ElicitationMeta
	} from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';
	import ElicitationForm from '$lib/components/mcp/ElicitationForm.svelte';

	type AskKind = 'approval' | 'sampling' | 'elicitation';

	type DurableProps = { item: DurableEntry; live?: false };
	type LiveProps = {
		live: true;
		payload: LiveAskPayload;
		summary?: string | null;
		onApprove: () => void;
		onDecline: () => void;
		onSubmitElicitation?: (data: Record<string, unknown>) => void;
	};

	let props: DurableProps | LiveProps = $props();

	const isDurable = $derived(props.live !== true);

	const askKind = $derived<AskKind>(
		isDurable
			? ((props as DurableProps).item.kind as AskKind)
			: (props as LiveProps).payload.askKind
	);

	const meta = $derived(() => {
		if (!isDurable) return null;
		const m = (props as DurableProps).item.entry.metadata;
		if (askKind === 'approval') return parseMetadata<ApprovalMeta>(m);
		if (askKind === 'sampling') return parseMetadata<SamplingMeta>(m);
		return parseMetadata<ElicitationMeta>(m);
	});

	const decision = $derived.by(() => {
		if (!isDurable) return 'pending' as const;
		const outcome = meta()?.outcome;
		if (!outcome) return 'pending' as const;
		if ('decision' in outcome) return outcome.decision;
		return 'pending' as const;
	});

	const chipClass = $derived.by(() => {
		const d = decision;
		if (d === 'approved' || d === 'allowed' || d === 'accepted')
			return 'bg-secondary text-secondary-foreground border-border';
		if (d === 'declined' || d === 'denied')
			return 'bg-destructive/10 text-destructive border-destructive/30';
		return 'bg-secondary text-secondary-foreground border-border';
	});

	const content = $derived(isDurable ? (props as DurableProps).item.entry.content : '');

	const livePayload = $derived(!isDurable ? (props as LiveProps).payload : null);

	let localDetailOpen = $state(false);
	let useJsonFallback = $state(false);
	let formData = $state<Record<string, unknown>>({});
	let jsonText = $state('{}');
	let jsonError = $state<string | null>(null);

	function handleLiveSubmit(): void {
		const lp = props as LiveProps;
		if (!lp.onSubmitElicitation) return;
		if (useJsonFallback) {
			try {
				const parsed = JSON.parse(jsonText);
				jsonError = null;
				lp.onSubmitElicitation(parsed);
			} catch (err) {
				jsonError = err instanceof Error ? err.message : 'Invalid JSON';
			}
			return;
		}
		lp.onSubmitElicitation(formData);
	}

	$effect(() => {
		if (props.live === true) localDetailOpen = true;
	});

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-start">
	<div class="flex items-center gap-1.5 px-1">
		{#if askKind === 'approval'}
			<ShieldCheck class="size-3 text-muted-foreground" />
		{:else if askKind === 'sampling'}
			<ShieldAlert class="size-3 text-muted-foreground" />
		{:else}
			<MessageCircleQuestion class="size-3 text-muted-foreground" />
		{/if}
		<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
			{#if askKind === 'approval'}
				Approval required
			{:else if askKind === 'sampling'}
				Sampling request
			{:else}
				Elicitation
			{/if}
		</span>
		<span class="rounded-full border px-2 py-0.5 text-xs {chipClass}">
			{decision}
		</span>
	</div>

	{#if isDurable && content}
		<button
			type="button"
			class="flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			onclick={() => (localDetailOpen = !localDetailOpen)}
		>
			{#if localDetailOpen}
				<ChevronDown class="size-3" />
			{:else}
				<ChevronRight class="size-3" />
			{/if}
			Details
		</button>
		{#if localDetailOpen}
			<div
				class="rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground"
			>
				{content}
			</div>
		{/if}
	{/if}

	{#if !isDurable && livePayload}
		<div class="rounded-md border border-border bg-card p-3 text-sm w-full">
			{#if askKind === 'approval' && livePayload.approval}
				{@const a = livePayload.approval}
				{@const lp = props as LiveProps}
				{#if lp.summary}
					<p class="font-medium">{lp.summary}</p>
					<p class="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
				{:else}
					<p class="font-medium">{a.description}</p>
				{/if}
				{#if a.args != null}
					<details class="mt-2">
						<summary class="cursor-pointer text-xs text-muted-foreground">Raw arguments</summary>
						<pre class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(
								a.args,
								null,
								2
							)}</pre>
					</details>
				{/if}
				<div class="mt-3 flex gap-2">
					<Button variant="default" size="sm" onclick={lp.onApprove}>Approve</Button>
					<Button variant="outline" size="sm" onclick={lp.onDecline}>Decline</Button>
				</div>
			{:else if askKind === 'sampling' && livePayload.sampling}
				{@const s = livePayload.sampling}
				{@const lp = props as LiveProps}
				<div class="flex items-center gap-2">
					<span
						class="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
					>
						MCP Sampling
					</span>
					<span class="font-medium">{s.serverName}</span>
				</div>
				<p class="mt-1 text-xs text-muted-foreground">
					Token budget: {s.remainingBudget} remaining (max {s.maxTokens} per call)
				</p>
				<details class="mt-2">
					<summary class="cursor-pointer text-xs text-muted-foreground"
						>Server prompt preview</summary
					>
					<pre
						class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{s.prompt}</pre>
				</details>
				<div class="mt-3 flex gap-2">
					<Button variant="default" size="sm" onclick={lp.onApprove}>Approve</Button>
					<Button variant="outline" size="sm" onclick={lp.onDecline}>Decline</Button>
				</div>
			{:else if askKind === 'elicitation' && livePayload.elicitation}
				{@const e = livePayload.elicitation}
				{@const lp = props as LiveProps}
				<p class="text-xs text-muted-foreground">{e.serverName}: {e.message}</p>
				<ElicitationForm
					schema={e.schema}
					fieldPrefix="efield"
					bind:formData
					bind:useJsonFallback
					bind:jsonText
					bind:jsonError
				/>
				<div class="mt-3 flex gap-2">
					<Button variant="outline" size="sm" onclick={lp.onDecline}>Cancel</Button>
					<Button variant="default" size="sm" onclick={handleLiveSubmit}>Submit</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
