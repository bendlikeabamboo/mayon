<script lang="ts">
	import { onMount } from 'svelte';
	import { Brain, Send, Square, Plug } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuCheckboxItem
	} from '$lib/components/ui/dropdown-menu/index.js';
	import { repos } from '$lib/db';
	import { buildMcpRuntimeState } from '$lib/mcp/lifecycle';
	import type { ReasoningEffort } from '$lib/ai/types';

	/**
	 * Prompt input + Send/Stop. Mirrors StreamDemo's interaction: ⌘/Ctrl+Enter
	 * sends, plain Enter inserts a newline. The actual send/streaming lives in
	 * `chatStore`; this component is a thin, controlled input.
	 *
	 * A 3-tier "Thinking" selector cycles through off → on → deep.
	 * The choice persists across reloads via the `reasoningEffort` settings KV.
	 */
	let {
		prompt = $bindable(''),
		streaming = $bindable(false),
		onSend,
		onStop,
		suggestedReplies,
		supportsDeep = true,
		providerName,
		modelId,
		progress,
		chatId
	}: {
		prompt?: string;
		streaming?: boolean;
		onSend: (text: string, effort: ReasoningEffort) => void | Promise<void>;
		onStop: () => void | Promise<void>;
		suggestedReplies?: string[];
		supportsDeep?: boolean;
		providerName?: string;
		modelId?: string;
		progress?: string | null;
		chatId?: string;
	} = $props();
	/** Reasoning effort: off (disabled), on (provider default), deep (extra reasoning). */
	let effort = $state<ReasoningEffort>('on');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	const MAX_TEXTAREA_H = 22 * 16;
	$effect(() => {
		void prompt;
		const el = textareaEl;
		if (!el) return;
		if (!prompt) {
			el.style.height = '';
			return;
		}
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_H) + 'px';
	});
	const canSend = $derived(prompt.trim().length > 0 && !streaming);
	const showChips = $derived(
		!!suggestedReplies?.length && !streaming && prompt.trim().length === 0
	);

	onMount(async () => {
		const v = await repos.settings.get<string>('reasoningEffort');
		if (v === 'off' || v === 'on' || v === 'deep') {
			effort = v;
			return;
		}
		const legacy = await repos.settings.get<boolean>('reasoningEnabled');
		effort = legacy === false ? 'off' : 'on';
		await repos.settings.set('reasoningEffort', effort);
		await repos.settings.delete('reasoningEnabled');
	});

	async function setEffort(next: ReasoningEffort) {
		if (streaming) return;
		effort = next;
		await repos.settings.set('reasoningEffort', next);
	}

	function sendChip(text: string) {
		prompt = '';
		void onSend(text, effort);
	}

	function send() {
		if (!canSend) return;
		const text = prompt.trim();
		prompt = '';
		void onSend(text, effort);
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			send();
		}
	}

	let mcpServers = $state<Array<{ id: string; name: string; toolCount: number; enabled: boolean }>>(
		[]
	);
	let mcpLoading = $state(false);

	async function loadMcpServers() {
		if (!chatId) return;
		mcpLoading = true;
		try {
			const [servers, mcpRuntimeState, chatMcpConfig] = await Promise.all([
				repos.mcp.listServers(),
				Promise.resolve(buildMcpRuntimeState()),
				repos.mcp.getChatMcpConfig(chatId)
			]);
			mcpServers = servers
				.filter((s) => s.enabled)
				.map((s) => {
					const runtime = mcpRuntimeState[s.id];
					const entry = chatMcpConfig?.[s.id];
					return {
						id: s.id,
						name: s.name,
						toolCount: runtime?.toolIds.length ?? 0,
						enabled: entry ? entry.enabled : true
					};
				});
		} finally {
			mcpLoading = false;
		}
	}

	$effect(() => {
		void chatId;
		void loadMcpServers();
	});

	async function toggleMcpServer(serverId: string) {
		if (!chatId) return;
		const chatMcpConfig = await repos.mcp.getChatMcpConfig(chatId);
		const cfg = chatMcpConfig ? { ...chatMcpConfig } : {};
		const entry = cfg[serverId];
		if (entry) {
			entry.enabled = !entry.enabled;
		} else {
			cfg[serverId] = { enabled: false };
		}
		await repos.mcp.setChatMcpConfig(chatId, cfg);
		await loadMcpServers();
	}

	const hasMcpServers = $derived(mcpServers.length > 0);
	const mcpAllDisabled = $derived(mcpServers.length > 0 && mcpServers.every((s) => !s.enabled));
</script>

<div class="flex flex-col gap-1.5">
	{#if (providerName && modelId) || progress}
		<div class="flex items-center gap-1.5 px-1 text-[11px] leading-none text-muted-foreground">
			{#if providerName && modelId}
				<span>{providerName} · {modelId}</span>
			{/if}
			{#if providerName && modelId && progress}
				<span aria-hidden="true">|</span>
			{/if}
			{#if progress}
				<span>{progress}</span>
			{/if}
		</div>
	{/if}
	{#if showChips}
		<div class="flex flex-wrap gap-1.5">
			{#each suggestedReplies as chip (chip)}
				<Button variant="outline" size="sm" onclick={() => sendChip(chip)}>
					{chip}
				</Button>
			{/each}
		</div>
	{/if}
	<div class="flex items-end gap-2">
		<textarea
			bind:this={textareaEl}
			bind:value={prompt}
			onkeydown={onKeydown}
			rows="2"
			placeholder="Message the active provider…  (⌘/Ctrl+Enter to send)"
			class="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
			disabled={streaming}></textarea>
		{#if hasMcpServers}
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button
						variant={mcpAllDisabled ? 'outline' : 'secondary'}
						size="icon"
						disabled={streaming || mcpLoading}
						title="MCP Tools"
						aria-label="MCP Tools"
					>
						<Plug class="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent side="top" align="end" class="w-64">
					<div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">MCP Servers</div>
					{#each mcpServers as server (server.id)}
						<DropdownMenuCheckboxItem
							checked={server.enabled}
							onCheckedChange={() => void toggleMcpServer(server.id)}
						>
							<div class="flex flex-col">
								<span>{server.name}</span>
								<span class="text-xs text-muted-foreground">
									{server.toolCount} tool{server.toolCount === 1 ? '' : 's'}
								</span>
							</div>
						</DropdownMenuCheckboxItem>
					{/each}
				</DropdownMenuContent>
			</DropdownMenu>
		{/if}
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button
					variant={effort === 'off' ? 'outline' : 'secondary'}
					size="icon"
					disabled={streaming}
					title="Thinking"
					aria-label="Thinking"
					aria-pressed={effort !== 'off'}
				>
					<Brain class="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="end" class="w-56">
				<DropdownMenuCheckboxItem
					checked={effort === 'off'}
					onCheckedChange={() => void setEffort('off')}
				>
					Off
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={effort === 'on'}
					onCheckedChange={() => void setEffort('on')}
				>
					On
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={effort === 'deep'}
					onCheckedChange={() => void setEffort('deep')}
				>
					<div class="flex flex-col">
						<span
							>Deep <span class="text-xs text-muted-foreground">(more reasoning tokens)</span></span
						>
						{#if !supportsDeep}
							<span class="text-xs text-amber-600 dark:text-amber-400"
								>not supported by this model</span
							>
						{/if}
					</div>
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
		{#if streaming}
			<Button
				variant="destructive"
				size="icon"
				onclick={() => void onStop()}
				title="Stop"
				aria-label="Stop"
			>
				<Square />
			</Button>
		{:else}
			<Button size="icon" onclick={send} disabled={!canSend} title="Send" aria-label="Send">
				<Send />
			</Button>
		{/if}
	</div>
</div>
