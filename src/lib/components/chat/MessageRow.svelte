<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from './Markdown.svelte';
	import Highlighter from './Highlighter.svelte';
	import { stripGateFence } from '$lib/ai/generate/generate-gate';
	import type { Message } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';
	import type { ExpoundOptions } from '$lib/chat/expound';

	/**
	 * A single message row. User/system rows render read-only markdown. Assistant
	 * rows wrap their content in a `<Highlighter>` so the user can select a span,
	 * right-click, and expound a child conversation grounded in that excerpt.
	 */
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
</script>

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
