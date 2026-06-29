<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from './Markdown.svelte';
	import Highlighter from './Highlighter.svelte';
	import { stripGateFence } from '$lib/ai/generate/generate-gate';
	import type { Message } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';
	import type { ExpoundOptions } from '$lib/chat/expound';

	let {
		message,
		onExpound,
		onCopy,
		onBranchWhole
	}: {
		message: Message;
		onExpound: (
			messageId: string,
			raw: string,
			sel: SelectionInput,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
	} = $props();

	const roleLabel: Record<Message['role'], string> = {
		user: 'You',
		assistant: 'Assistant',
		system: 'System',
		tool: 'Tool'
	};

	const bubbleClass: Record<Message['role'], string> = {
		user: 'bg-[var(--highlight)] text-white dark:bg-primary dark:text-primary-foreground',
		assistant: 'border border-border bg-background text-foreground',
		system: 'bg-amber-500/10 text-amber-900 dark:text-amber-200 italic',
		tool: 'border border-border bg-muted/50 text-muted-foreground'
	};

	function parseMetadata(raw: string | null): { artifact?: { kind: string; id: string } } | null {
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	function artifactHref(artifact: { kind: string; id: string }): string {
		if (artifact.kind === 'chat') return `/chat/${artifact.id}`;
		if (artifact.kind === 'lab') return `/lab/${artifact.id}`;
		if (artifact.kind === 'quiz') return `/quiz/${artifact.id}`;
		return `/${artifact.kind}/${artifact.id}`;
	}

	let parsedMeta = $derived(parseMetadata(message.metadata));
	let artifact = $derived(parsedMeta?.artifact);
</script>

{#if message.role === 'assistant' && message.toolCallId != null && message.content === ''}
	<!-- empty tool-call bookkeeping row, hidden -->
{:else if message.role === 'tool'}
	<div class="flex flex-col gap-1">
		<span class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
			{#if artifact}
				<a href={artifactHref(artifact)} class="hover:underline">{message.content}</a>
			{:else}
				{message.content}
			{/if}
		</span>
	</div>
{:else}
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2 px-1">
			<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{roleLabel[message.role]}
			</span>
			{#if message.role === 'assistant'}
				<Button
					variant="ghost"
					size="sm"
					class="h-6 px-2 text-xs text-muted-foreground"
					title="Branch a new chat from this whole message"
					onclick={() => void onBranchWhole(message.id)}
				>
					<GitBranch class="size-3" /> Branch
				</Button>
			{/if}
		</div>
		<div class="rounded-lg px-4 py-2.5 {bubbleClass[message.role]}">
			{#if message.role === 'assistant'}
				{@const visible = stripGateFence(message.content)}
				<Highlighter
					raw={visible}
					messageId={message.id}
					onExpound={(raw, sel, opts) => onExpound(message.id, raw, sel, opts)}
					{onCopy}
				>
					<Markdown raw={visible} />
				</Highlighter>
			{:else}
				<Markdown raw={message.content} />
			{/if}
		</div>
	</div>
{/if}
