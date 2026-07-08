<script lang="ts">
	import { onMount } from 'svelte';
	import { Brain, Send, Square, Plug, FileText, MessageSquarePlus, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuCheckboxItem,
		DropdownMenuItem
	} from '$lib/components/ui/dropdown-menu/index.js';
	import { repos } from '$lib/db';
	import {
		buildMcpRuntimeState,
		getMountedResources,
		getMountedPrompts,
		readResourceForAttach,
		type MountedResourceInfo,
		type MountedPromptInfo
	} from '$lib/mcp/lifecycle';
	import { renderPrompt } from '$lib/mcp/prompts';
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

	let mountedResources = $state<MountedResourceInfo[]>([]);
	let mountedPrompts = $state<MountedPromptInfo[]>([]);
	let attachments = $state<
		Array<{ serverId: string; uri: string; name: string; serverName: string }>
	>([]);
	let resourceLoading = $state(false);

	async function loadMcpResources() {
		if (!chatId) return;
		try {
			mountedResources = await getMountedResources();
			mountedPrompts = await getMountedPrompts();
			const raw = await repos.mcp.listAttachments(chatId);
			attachments = raw.map((a) => ({
				serverId: a.serverId,
				uri: a.uri,
				name: a.name,
				serverName: a.serverName
			}));
		} catch {
			// ignore
		}
	}

	$effect(() => {
		void chatId;
		void loadMcpResources();
	});

	const hasResources = $derived(mountedResources.some((s) => s.resources.length > 0));
	const hasPrompts = $derived(mountedPrompts.some((s) => s.prompts.length > 0));

	async function attachResource(
		serverId: string,
		uri: string,
		name: string,
		serverName: string,
		mimeType?: string
	) {
		if (!chatId || resourceLoading) return;
		resourceLoading = true;
		try {
			const result = await readResourceForAttach(serverId, uri);
			if ('error' in result) {
				toastError(result.error);
				return;
			}
			await repos.mcp.addAttachment(chatId, {
				serverId,
				serverName,
				uri,
				name,
				mimeType,
				content: result.content,
				attachedAt: Date.now()
			});
			await loadMcpResources();
		} finally {
			resourceLoading = false;
		}
	}

	async function detachResource(serverId: string, uri: string) {
		if (!chatId) return;
		await repos.mcp.removeAttachment(chatId, serverId, uri);
		await loadMcpResources();
	}

	async function insertPrompt(serverId: string, name: string, _serverName: string) {
		if (!chatId) return;
		const result = await renderPrompt(serverId, name);
		if (result.error) {
			toastError(result.error);
			return;
		}
		prompt = prompt ? prompt + '\n\n' + result.text : result.text;
	}

	let toastMessage = $state('');
	let toastVisible = $state(false);

	function toastError(msg: string) {
		toastMessage = msg;
		toastVisible = true;
		setTimeout(() => {
			toastVisible = false;
		}, 3000);
	}
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
	{#if toastVisible}
		<div class="px-1 py-0.5 text-xs text-destructive">{toastMessage}</div>
	{/if}
	{#if attachments.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each attachments as att (att.serverId + ':' + att.uri)}
				<div
					class="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs"
				>
					<FileText class="size-3 text-muted-foreground" />
					<span class="text-muted-foreground">{att.serverName}:</span>
					<span>{att.name}</span>
					<button
						type="button"
						class="ml-0.5 text-muted-foreground hover:text-foreground"
						onclick={() => void detachResource(att.serverId, att.uri)}
						aria-label="Detach resource"
					>
						<X class="size-3" />
					</button>
				</div>
			{/each}
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
		{#if hasResources}
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button
						variant="secondary"
						size="icon"
						disabled={streaming || resourceLoading}
						title="MCP Resources"
						aria-label="MCP Resources"
					>
						<FileText class="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent side="top" align="end" class="w-72">
					<div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">Resources</div>
					{#each mountedResources as server (server.serverId)}
						{#if server.resources.length > 0}
							<div class="px-2 py-1 text-xs font-medium text-muted-foreground">
								{server.serverName}
							</div>
							{#each server.resources as res (res.uri)}
								<DropdownMenuItem
									onclick={() =>
										void attachResource(
											server.serverId,
											res.uri,
											res.name,
											server.serverName,
											res.mimeType
										)}
								>
									<div class="flex flex-col">
										<span>{res.name}</span>
										<span class="text-xs text-muted-foreground">{res.uri}</span>
									</div>
								</DropdownMenuItem>
							{/each}
						{/if}
					{/each}
				</DropdownMenuContent>
			</DropdownMenu>
		{/if}
		{#if hasPrompts}
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button
						variant="secondary"
						size="icon"
						disabled={streaming}
						title="Insert MCP prompt"
						aria-label="Insert MCP prompt"
					>
						<MessageSquarePlus class="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent side="top" align="end" class="w-72">
					<div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">Insert MCP prompt</div>
					{#each mountedPrompts as server (server.serverId)}
						{#if server.prompts.length > 0}
							<div class="px-2 py-1 text-xs font-medium text-muted-foreground">
								{server.serverName}
							</div>
							{#each server.prompts as pr (server.serverId + ':' + pr.name)}
								<DropdownMenuItem
									onclick={() => void insertPrompt(server.serverId, pr.name, server.serverName)}
								>
									<div class="flex flex-col">
										<span>{pr.name}</span>
										{#if pr.description}
											<span class="text-xs text-muted-foreground">{pr.description}</span>
										{/if}
									</div>
								</DropdownMenuItem>
							{/each}
						{/if}
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
