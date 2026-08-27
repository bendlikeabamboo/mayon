<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Brain,
		Send,
		Square,
		Plug,
		FileText,
		MessageSquarePlus,
		X,
		GitBranch,
		ListChecks,
		FlaskConical,
		LoaderCircle
	} from '@lucide/svelte';
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
	 * Prompt input rendered as an instrument card: a bordered raised container
	 * carrying the focus state (the textarea itself is de-boxed), with all
	 * controls docked along its bottom edge INSIDE its footprint.
	 *
	 * Mirrors StreamDemo's interaction: ⌘/Ctrl+Enter sends, plain Enter inserts
	 * a newline. The actual send/streaming lives in `chatStore`; this component
	 * is a thin, controlled input.
	 *
	 * A 3-tier "Thinking" selector cycles through off → on → deep.
	 * The choice persists across reloads via the `reasoningEffort` settings KV.
	 *
	 * Artifact launchers ("branch here" · "quiz me" · "open lab") sit in the
	 * same docked footer; each terminates in a persisted artifact through the
	 * handlers passed by the route (GP-3: no transient panels).
	 */
	let {
		prompt = $bindable(''),
		streaming = $bindable(false),
		onSend,
		onStop,
		onBranch,
		onQuiz,
		onLab,
		supportsDeep = true,
		providerName,
		modelId,
		chatId,
		canGenerate = true,
		quizBusy = false,
		labBusy = false
	}: {
		prompt?: string;
		streaming?: boolean;
		onSend: (text: string, effort: ReasoningEffort) => void | Promise<void>;
		onStop: () => void | Promise<void>;
		/** Launcher outcomes are persisted artifacts wired by the route. */
		onBranch: () => void | Promise<void>;
		onQuiz: () => void | Promise<void>;
		onLab: () => void | Promise<void>;
		supportsDeep?: boolean;
		providerName?: string;
		modelId?: string;
		chatId?: string;
		/** True when an active provider exists (prerequisite for quiz/lab gen). */
		canGenerate?: boolean;
		/** A quiz generation is already in flight (disable-with-explanation). */
		quizBusy?: boolean;
		/** A lab generation is already in flight (disable-with-explanation). */
		labBusy?: boolean;
	} = $props();
	/** Reasoning effort: off (disabled), on (provider default), deep (extra reasoning). */
	let effort = $state<ReasoningEffort>('on');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	const MAX_TEXTAREA_H = 22 * 16;
	const BRANCH_STREAMING_TITLE = 'Finish streaming the current reply before branching.';
	const GEN_NO_PROVIDER_TITLE =
		'No active provider — set one up in Settings to generate quizzes and labs.';
	const GEN_BUSY_TITLE = 'A quiz or lab generation is already running.';
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

	const artifactsBusy = $derived(quizBusy || labBusy);
	const branchBlocked = $derived(streaming);
	const branchTitle = $derived(
		branchBlocked ? BRANCH_STREAMING_TITLE : 'Branch here: creates a tree node under this chat'
	);
	/** Null when quiz/lab generation is available right now, else the reason. */
	const generationBlocker = $derived(
		!canGenerate
			? GEN_NO_PROVIDER_TITLE
			: streaming
				? BRANCH_STREAMING_TITLE
				: artifactsBusy
					? GEN_BUSY_TITLE
					: null
	);
	const generationBlocked = $derived(generationBlocker !== null);
	const quizTitle = $derived(
		generationBlocker ?? 'Quiz me: generates a quiz artifact bound to this conversation'
	);
	const labTitle = $derived(
		generationBlocker ?? 'Open lab: generates a lab artifact bound to this conversation'
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
	{#if providerName && modelId}
		<div class="flex items-center gap-1.5 px-1 text-[11px] leading-none text-muted-foreground">
			<span>{providerName} · {modelId}</span>
		</div>
	{/if}
	{#if toastVisible}
		<div class="px-1 py-0.5 text-xs text-destructive">{toastMessage}</div>
	{/if}
	<div
		class="surface-card rounded-xl transition-[box-shadow,border-color] duration-200 focus-within:border-ring focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/30"
	>
		{#if attachments.length > 0}
			<div class="flex flex-wrap gap-1.5 px-3 pt-2.5">
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
		<textarea
			bind:this={textareaEl}
			bind:value={prompt}
			onkeydown={onKeydown}
			rows="2"
			placeholder="Message the active provider…  (⌘/Ctrl+Enter to send)"
			class="min-w-0 flex-1 resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground/60"
			disabled={streaming}></textarea>
		<div class="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
					title={branchTitle}
					data-tip={branchTitle}
					class:tip={branchBlocked}
					aria-label={branchTitle}
					onclick={() => void onBranch()}
					disabled={branchBlocked}
				>
					<GitBranch class="size-3.5" />
					<span>branch here</span>
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
					title={quizTitle}
					data-tip={quizTitle}
					class:tip={generationBlocked}
					aria-label={quizTitle}
					onclick={() => void onQuiz()}
					disabled={generationBlocked}
				>
					{#if quizBusy}
						<LoaderCircle class="size-3.5 animate-spin" />
					{:else}
						<ListChecks class="size-3.5" />
					{/if}
					<span>quiz me</span>
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
					title={labTitle}
					data-tip={labTitle}
					class:tip={generationBlocked}
					aria-label={labTitle}
					onclick={() => void onLab()}
					disabled={generationBlocked}
				>
					{#if labBusy}
						<LoaderCircle class="size-3.5 animate-spin" />
					{:else}
						<FlaskConical class="size-3.5" />
					{/if}
					<span>open lab</span>
				</button>
			</div>
			<div class="flex items-center gap-2">
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
							<div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
								Insert MCP prompt
							</div>
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
									>Deep <span class="text-xs text-muted-foreground">(more reasoning tokens)</span
									></span
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
	</div>
</div>
