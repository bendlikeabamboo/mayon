<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from './Markdown.svelte';
	import Highlighter from './Highlighter.svelte';
	import type { Message } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';

	/**
	 * A single message row. User/system rows render read-only markdown. Assistant
	 * rows wrap their content in a `<Highlighter>` so the user can select a span
	 * and branch a child conversation grounded in that excerpt.
	 */
	let {
		message,
		onBranchSelection,
		onBranchWhole
	}: {
		message: Message;
		onBranchSelection: (
			messageId: string,
			raw: string,
			sel: SelectionInput
		) => void | Promise<void>;
		onBranchWhole: (messageId: string) => void | Promise<void>;
	} = $props();

	const roleLabel: Record<Message['role'], string> = {
		user: 'You',
		assistant: 'Assistant',
		system: 'System'
	};

	const bubbleClass: Record<Message['role'], string> = {
		user: 'bg-primary text-primary-foreground',
		assistant: 'bg-muted text-foreground',
		system: 'bg-amber-500/10 text-amber-900 dark:text-amber-200 italic'
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
			<Highlighter
				raw={message.content}
				onBranch={(raw, sel) => onBranchSelection(message.id, raw, sel)}
			>
				<Markdown raw={message.content} />
			</Highlighter>
		{:else}
			<Markdown raw={message.content} />
		{/if}
	</div>
</div>
