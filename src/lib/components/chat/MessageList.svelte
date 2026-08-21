<script lang="ts">
	import type { Snippet } from 'svelte';
	import LazyMount from './LazyMount.svelte';
	import type { ResolvedOffsets } from '$lib/chat/selection';
	import type { ExpoundOptions } from '$lib/chat/expound';
	import {
		assembleTimeline,
		type TimelineItem,
		type LiveEntry,
		isDurableEntry,
		isToolGroup,
		isOrphanToolResult,
		isLiveEntry
	} from '$lib/chat/entries';
	import UserMessage from './rows/UserMessage.svelte';
	import AssistantMessage from './rows/AssistantMessage.svelte';
	import ReasoningEntry from './rows/ReasoningEntry.svelte';
	import SelfCorrected from './rows/SelfCorrected.svelte';
	import ToolActivity from './rows/ToolActivity.svelte';
	import AskEntry from './rows/AskEntry.svelte';
	import ChoicesOffer from './rows/ChoicesOffer.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { parseMetadata, type UserMessageMeta, type ChoicesMeta } from '$lib/chat/kinds';
	import type { LiveAskPayload } from '$lib/chat/entries';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { summarizeToolCall } from '$lib/agent/tool-summary';
	import { findGateFromMessages } from '$lib/ai/generate/generate-gate';

	let {
		messages,
		liveItems = [],
		onExpound,
		onCopy,
		onBranchWhole,
		onRegenerate,
		header,
		personaName = 'Mayon',
		failedMessageId = null,
		streaming = false
	}: {
		messages: import('$lib/db/schema').Message[];
		liveItems?: LiveEntry[];
		onExpound: (
			messageId: string,
			raw: string,
			resolved: ResolvedOffsets,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
		onRegenerate?: (messageId: string) => void | Promise<void>;
		header?: Snippet;
		personaName?: string;
		failedMessageId?: string | null;
		streaming?: boolean;
	} = $props();

	const activeGate = $derived(!streaming ? findGateFromMessages(messages) : null);

	const timeline = $derived(assembleTimeline(messages, liveItems, streaming));

	const takenChoices = $derived.by(() => {
		const entries: [string, string][] = [];
		for (const item of timeline) {
			if (!isDurableEntry(item) || item.kind !== 'user_message') continue;
			const meta = parseMetadata<UserMessageMeta>(item.entry.metadata);
			if (meta?.choicesEntryId) {
				const linkedChoice = timeline.find(
					(t) => isDurableEntry(t) && t.kind === 'choices' && t.entry.id === meta.choicesEntryId
				);
				if (linkedChoice && isDurableEntry(linkedChoice)) {
					const choiceMeta = parseMetadata<ChoicesMeta>(linkedChoice.entry.metadata);
					const options = choiceMeta?.options ?? [];
					const taken = item.entry.content.trim();
					if (options.includes(taken)) {
						entries.push([meta.choicesEntryId, taken]);
					}
				}
			}
		}
		return new SvelteMap(entries);
	});

	function itemId(item: TimelineItem): string {
		if (isToolGroup(item)) return item.call.id;
		if (isOrphanToolResult(item)) return item.result.id;
		if (isDurableEntry(item)) return item.entry.id;
		if (item.live === 'live_text') return 'live-text';
		if (item.live === 'live_reasoning') return 'live-reasoning';
		return 'live-ask-' + item.payload.rowId;
	}

	function onApproveAsk(payload: LiveAskPayload) {
		if (payload.askKind === 'approval' && payload.approval) {
			chatStore.approve(payload.approval.toolCallId);
		} else if (payload.askKind === 'sampling' && payload.sampling) {
			chatStore.approveSampling(payload.sampling.id);
		} else if (payload.askKind === 'elicitation' && payload.elicitation) {
			// submit with empty data — user must use the form
		}
	}

	function onDeclineAsk(payload: LiveAskPayload) {
		if (payload.askKind === 'approval' && payload.approval) {
			chatStore.decline(payload.approval.toolCallId);
		} else if (payload.askKind === 'sampling' && payload.sampling) {
			chatStore.declineSampling(payload.sampling.id);
		} else if (payload.askKind === 'elicitation' && payload.elicitation) {
			chatStore.cancelElicitation(payload.elicitation.id);
		}
	}

	function onSubmitElicitation(payload: LiveAskPayload, data: Record<string, unknown>) {
		if (payload.elicitation) {
			chatStore.submitElicitation(payload.elicitation.id, data);
		}
	}

	function summarizeApproval(payload: LiveAskPayload): string | null {
		if (!payload.approval) return null;
		return summarizeToolCall(payload.approval.toolName, payload.approval.args);
	}
</script>

<div class="min-w-0 flex flex-col gap-4">
	{#if header}
		{@render header()}
	{/if}
	{#each timeline as item (itemId(item))}
		<div id="msg-{itemId(item)}">
			{#if isLiveEntry(item)}
				{#if item.live === 'live_reasoning'}
					<ReasoningEntry live={true} buffer={item.buffer} />
				{:else if item.live === 'live_text'}
					<AssistantMessage live={true} buffer={item.buffer} pending={item.pending} {personaName} />
				{:else if item.live === 'live_ask'}
					<AskEntry
						live={true}
						payload={item.payload}
						summary={item.payload.askKind === 'approval' ? summarizeApproval(item.payload) : null}
						onApprove={() => onApproveAsk(item.payload)}
						onDecline={() => onDeclineAsk(item.payload)}
						onSubmitElicitation={(data: Record<string, unknown>) =>
							onSubmitElicitation(item.payload, data)}
					/>
				{/if}
			{:else}
				<LazyMount unmountFar rootMargin="1200px">
					{#if isToolGroup(item) || isOrphanToolResult(item)}
						<ToolActivity {item} />
					{:else if isDurableEntry(item)}
						{#if item.kind === 'user_message'}
							<UserMessage {item} />
						{:else if item.kind === 'assistant_message'}
							<AssistantMessage
								{item}
								{onExpound}
								{onCopy}
								{onBranchWhole}
								{onRegenerate}
								{personaName}
								failed={item.entry.id === failedMessageId}
							/>
						{:else if item.kind === 'reasoning'}
							<ReasoningEntry {item} />
						{:else if item.kind === 'self_corrected'}
							<SelfCorrected {item} />
						{:else if item.kind === 'approval' || item.kind === 'sampling' || item.kind === 'elicitation'}
							<AskEntry {item} />
						{:else if item.kind === 'choices'}
							<ChoicesOffer
								{item}
								linkedTakenOption={takenChoices.get(item.entry.id)}
								onSelect={activeGate?.entryId === item.entry.id && !takenChoices.get(item.entry.id)
									? (option: string) => {
											void chatStore.send(option, { choicesEntryId: item.entry.id });
										}
									: undefined}
							/>
						{/if}
					{/if}
				</LazyMount>
			{/if}
		</div>
	{/each}

	{#if timeline.length === 0 && !streaming}
		<p class="py-8 text-center text-sm text-muted-foreground">
			No messages yet. Send a prompt below.
		</p>
	{/if}
</div>
