<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from './Markdown.svelte';
	import Reasoning from './Reasoning.svelte';
	import Highlighter from './Highlighter.svelte';
	import LazyMount from './LazyMount.svelte';
	import { stripGateFence } from '$lib/ai/generate/generate-gate';
	import type { Message } from '$lib/db/schema';
	import type { ResolvedOffsets } from '$lib/chat/selection';
	import type { ExpoundOptions } from '$lib/chat/expound';

	let {
		message,
		onExpound,
		onCopy,
		onBranchWhole,
		onRegenerate,
		personaName = 'Mayon',
		failed = false
	}: {
		message: Message;
		onExpound: (
			messageId: string,
			raw: string,
			resolved: ResolvedOffsets,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
		onRegenerate?: (messageId: string) => void | Promise<void>;
		personaName?: string;
		failed?: boolean;
	} = $props();

	function roleLabel(role: Message['role']): string {
		if (role === 'assistant') return personaName;
		if (role === 'user') return 'You';
		if (role === 'system') return 'System';
		return 'Tool';
	}

	const bubbleClass: Record<Message['role'], string> = {
		user: 'bg-[var(--highlight)] text-white dark:bg-primary dark:text-primary-foreground',
		assistant: 'border border-border bg-background text-foreground',
		system: 'bg-amber-500/10 text-amber-900 dark:text-amber-200 italic',
		tool: 'border border-border bg-muted/50 text-muted-foreground'
	};

	function parseMetadata(raw: string | null): {
		artifact?: { kind: string; id: string };
		reasoning?: string;
		interrupted?: boolean;
	} | null {
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
	let reasoning = $derived(
		message.role === 'assistant' && !message.toolCallId ? parsedMeta?.reasoning : undefined
	);
	let interrupted = $derived(parsedMeta?.interrupted === true);
	let reasoningOpen = $state(false);
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
	<div class="flex flex-col gap-1 {message.role === 'user' ? 'items-end' : 'items-start'}">
		<div class="flex w-full items-center justify-between">
			<div class="flex items-center">
				<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{roleLabel(message.role)}
				</span>
				{#if message.role === 'assistant' && reasoning}
					<Reasoning {reasoning} inline bind:open={reasoningOpen} />
				{/if}
			</div>
			{#if message.role === 'assistant'}
				<Button
					variant="ghost"
					size="sm"
					class="h-6 px-2 text-xs text-muted-foreground"
					title="Branch a new chat from this whole message"
					onclick={() => void onBranchWhole(message.id)}
				>
					<GitBranch class="size-3" /> Branch from this message
				</Button>
			{/if}
		</div>
		{#if message.role === 'assistant' && reasoning && reasoningOpen}
			<div
				class="max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-muted-foreground italic"
			>
				<Markdown raw={reasoning} />
			</div>
		{/if}
		<div
			class="{message.role === 'user' ? 'max-w-[75%]' : 'min-w-0 max-w-full'} {message.role ===
			'user'
				? 'no-text-thin'
				: ''} {failed ? 'border-l-2 border-red-500/60' : ''} rounded-lg px-4 py-2.5 {bubbleClass[
				message.role
			]} {message.role === 'user' ? 'markdown-invert bubble-user' : ''}"
			style={message.role === 'user' ? '--bubble-bg: var(--highlight); --bubble-fg: #fff;' : ''}
		>
			{#if message.role === 'assistant'}
				{@const visible = stripGateFence(message.content)}
				<Highlighter
					raw={visible}
					messageId={message.id}
					onExpound={(raw, sel, opts) => onExpound(message.id, raw, sel, opts)}
					{onCopy}
				>
					<LazyMount><Markdown raw={visible} /></LazyMount>
				</Highlighter>
			{:else}
				<LazyMount><Markdown raw={message.content} /></LazyMount>
			{/if}
		</div>
		{#if interrupted && message.role === 'assistant'}
			<div
				class="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground"
			>
				This reply was interrupted.
				{#if onRegenerate}
					<Button
						variant="outline"
						size="sm"
						class="h-6 px-2"
						onclick={() => void onRegenerate(message.id)}>Regenerate</Button
					>
				{/if}
			</div>
		{/if}
	</div>
{/if}
