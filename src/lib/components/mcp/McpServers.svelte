<script lang="ts">
	import { onMount } from 'svelte';
	import {
		CheckCircle2,
		ClipboardPaste,
		Edit3,
		Plus,
		ShieldAlert,
		Trash2,
		Unplug,
		Wrench,
		Monitor,
		Globe
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog/index.js';
	import { MCP_SERVER_TEMPLATES } from '$lib/mcp/templates';
	import type { McpServerTemplate } from '$lib/mcp/types';
	import { isTrusted, trustNow } from '$lib/mcp/trust';
	import { parseClaudeDesktopConfig } from '$lib/mcp/import';
	import { testConnection } from '$lib/mcp/lifecycle';
	import { setMcpSecret, deleteMcpSecret, deleteServerSecrets } from '$lib/mcp/keystore';
	import { repos } from '$lib/db';
	import { uuid } from '$lib/db/ids';
	import type { McpServerConfig } from '$lib/mcp/types';
	import { serverStatus } from '$lib/server/status.svelte';

	let servers = $state<McpServerConfig[]>([]);
	let trustFlags = $state<Record<string, boolean>>({});
	let secretFlags = $state<Record<string, string[]>>({});
	let loading = $state(true);
	let saving = $state(false);
	let status = $state<string | null>(null);
	let expandedId = $state<string | null>(null);
	let adding = $state(false);
	let importing = $state(false);
	let importDraft = $state('');
	let importError = $state<string | null>(null);
	let testing = $state<Record<string, boolean>>({});
	let testResults = $state<
		Record<
			string,
			| { tools: number; resources?: number; prompts?: number }
			| { error: string; corsBlocked?: boolean }
		>
	>({});
	let trustingId = $state<string | null>(null);
	let _envDrafts = $state<Record<string, Record<string, string>>>({});
	let secretDrafts = $state<Record<string, string>>({});
	let _headerDrafts = $state<Record<string, string>>({});
	let draftServer = $state<McpServerConfig | null>(null);
	let draftSecretDraft = $state<Record<string, string>>({});

	function isTemplateAvailable(t: McpServerTemplate): boolean {
		if (t.transport === 'stdio') return serverStatus.has('stdio-mcp');
		return true;
	}

	const inputClass =
		'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

	onMount(load);

	async function load() {
		loading = true;
		servers = await repos.mcp.listServers();
		trustFlags = {};
		secretFlags = {};
		for (const s of servers) {
			trustFlags[s.id] = await isTrusted(s);
			secretFlags[s.id] = Object.keys(s.env ?? {});
		}
		loading = false;
	}

	function setStatus(msg: string | null) {
		status = msg;
	}

	async function persist() {
		saving = true;
		setStatus(null);
		try {
			const map: Record<string, McpServerConfig> = {};
			for (const s of servers) map[s.id] = s;
			await repos.mcp.saveServers(map);
			setStatus('Saved.');
		} catch (err) {
			setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			saving = false;
		}
	}

	function updateServer(id: string, patch: Partial<McpServerConfig>) {
		servers = servers.map((s) => (s.id === id ? { ...s, ...patch } : s));
	}

	function addFromTemplate(t: McpServerTemplate) {
		if (!isTemplateAvailable(t)) return;
		const id = uuid();
		draftServer = {
			id,
			name: t.label,
			transport: t.transport,
			command: t.command,
			args: t.args ? [...t.args] : undefined,
			env: t.env ? JSON.parse(JSON.stringify(t.env)) : undefined,
			url: t.url,
			headers: t.headers ? JSON.parse(JSON.stringify(t.headers)) : undefined,
			enabled: false,
			trustedHash: undefined,
			createdAt: Date.now()
		};
		draftSecretDraft = {};
		adding = false;
	}

	function updateDraft(patch: Partial<McpServerConfig>) {
		if (!draftServer) return;
		draftServer = { ...draftServer, ...patch };
	}

	async function confirmDraft() {
		if (!draftServer) return;
		servers = [...servers, draftServer];
		const savedId = draftServer.id;
		draftServer = null;
		draftSecretDraft = {};
		await persist();
		const s = servers.find((x) => x.id === savedId);
		if (s) {
			trustFlags[savedId] = await isTrusted(s);
			secretFlags[savedId] = Object.keys(s.env ?? {});
		}
		setStatus('Server created.');
	}

	function cancelDraft() {
		draftServer = null;
		draftSecretDraft = {};
	}

	function onDraftNameInput(value: string) {
		updateDraft({ name: value });
	}

	function onDraftCommandInput(value: string) {
		updateDraft({ command: value || undefined });
	}

	function onDraftArgsInput(value: string) {
		const args = value.split(/\s+/).filter(Boolean);
		updateDraft({ args: args.length > 0 ? args : undefined });
	}

	function onDraftUrlInput(value: string) {
		updateDraft({ url: value || undefined });
	}

	function onDraftCwdInput(value: string) {
		updateDraft({ cwd: value || undefined });
	}

	function onDraftTimeoutInput(value: string) {
		const n = parseInt(value, 10);
		updateDraft({ callTimeoutMs: isNaN(n) ? undefined : n });
	}

	function onDraftResultCapInput(value: string) {
		const n = parseInt(value, 10);
		updateDraft({ resultCapBytes: isNaN(n) ? undefined : n });
	}

	async function draftAddHeader() {
		if (!draftServer) return;
		const name = `header-${Object.keys(draftServer.headers ?? {}).length + 1}`;
		const headers = { ...(draftServer.headers ?? {}), [name]: { value: '' } };
		updateDraft({ headers });
	}

	function draftRemoveHeader(name: string) {
		if (!draftServer) return;
		const headers = { ...(draftServer.headers ?? {}) };
		delete headers[name];
		updateDraft({ headers: Object.keys(headers).length > 0 ? headers : undefined });
	}

	function draftRenameHeader(oldName: string, newName: string) {
		if (!draftServer || !draftServer.headers || !newName.trim()) return;
		if (oldName === newName) return;
		const headers: Record<string, { secretRef?: string; value?: string }> = {};
		for (const [k, v] of Object.entries(draftServer.headers)) {
			headers[k === oldName ? newName.trim() : k] = v;
		}
		updateDraft({ headers });
	}

	function onDraftHeaderValueInput(name: string, value: string) {
		if (!draftServer) return;
		updateDraft({
			headers: { ...draftServer.headers, [name]: { value } }
		});
	}

	async function draftAddEnvVar() {
		if (!draftServer) return;
		const name = `ENV_VAR_${Object.keys(draftServer.env ?? {}).length + 1}`;
		const env = { ...(draftServer.env ?? {}), [name]: { secretRef: '' } };
		updateDraft({ env });
	}

	function draftRemoveEnvVar(name: string) {
		if (!draftServer) return;
		const env = { ...(draftServer.env ?? {}) };
		delete env[name];
		updateDraft({ env: Object.keys(env).length > 0 ? env : undefined });
	}

	function draftRenameEnvVar(oldName: string, newName: string) {
		if (!draftServer || !draftServer.env || !newName.trim()) return;
		if (oldName === newName) return;
		const env: Record<string, { secretRef: string }> = {};
		for (const [k, v] of Object.entries(draftServer.env)) {
			env[k === oldName ? newName.trim() : k] = v;
		}
		updateDraft({ env });
	}

	function toggleEnabled(id: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		updateServer(id, { enabled: !s.enabled });
		void persist();
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	function commitField(id: string) {
		void persist().then(async () => {
			const s = servers.find((x) => x.id === id);
			if (s) trustFlags[id] = await isTrusted(s);
		});
	}

	function onNameInput(id: string, value: string) {
		updateServer(id, { name: value });
	}

	function onNameChange(id: string) {
		commitField(id);
	}

	function onCommandInput(id: string, value: string) {
		updateServer(id, { command: value || undefined });
	}

	function onArgsInput(id: string, value: string) {
		const args = value.split(/\s+/).filter(Boolean);
		updateServer(id, { args: args.length > 0 ? args : undefined });
	}

	function onUrlInput(id: string, value: string) {
		updateServer(id, { url: value || undefined });
	}

	function onCwdInput(id: string, value: string) {
		updateServer(id, { cwd: value || undefined });
	}

	function onTimeoutInput(id: string, value: string) {
		const n = parseInt(value, 10);
		updateServer(id, { callTimeoutMs: isNaN(n) ? undefined : n });
	}

	function onResultCapInput(id: string, value: string) {
		const n = parseInt(value, 10);
		updateServer(id, { resultCapBytes: isNaN(n) ? undefined : n });
	}

	async function addHeader(id: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		const name = `header-${Object.keys(s.headers ?? {}).length + 1}`;
		const headers = { ...(s.headers ?? {}), [name]: { value: '' } };
		updateServer(id, { headers });
		await persist();
	}

	function removeHeader(id: string, name: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		const headers = { ...(s.headers ?? {}) };
		const entry = headers[name];
		if (entry?.secretRef) {
			void deleteMcpSecret(id, name);
			secretFlags = {
				...secretFlags,
				[id]: (secretFlags[id] ?? []).filter((n) => n !== name)
			};
		}
		delete headers[name];
		updateServer(id, { headers: Object.keys(headers).length > 0 ? headers : undefined });
		void persist();
	}

	function renameHeader(id: string, oldName: string, newName: string) {
		const s = servers.find((x) => x.id === id);
		if (!s || !s.headers || !newName.trim() || oldName === newName) return;
		const entry = s.headers[oldName];
		if (!entry) return;
		const headers: Record<string, { secretRef?: string; value?: string }> = {};
		for (const [k, v] of Object.entries(s.headers)) {
			headers[k === oldName ? newName.trim() : k] = v;
		}
		updateServer(id, { headers });
		void persist();
	}

	async function saveHeaderSecret(serverId: string, name: string, raw: string) {
		const trimmed = raw.trim();
		if (trimmed) {
			await setMcpSecret(serverId, name, trimmed);
		} else {
			await deleteMcpSecret(serverId, name);
		}
		const s = servers.find((x) => x.id === serverId);
		if (s && s.headers && s.headers[name]) {
			updateServer(serverId, {
				headers: { ...s.headers, [name]: { secretRef: `mcp:${serverId}:${name}` } }
			});
			void persist();
		}
		_headerDrafts = { ..._headerDrafts, [serverId]: '' };
		setStatus('Secret saved.');
	}

	async function saveHeaderValue(serverId: string, name: string, raw: string) {
		const s = servers.find((x) => x.id === serverId);
		if (s && s.headers && s.headers[name]) {
			updateServer(serverId, {
				headers: { ...s.headers, [name]: { value: raw.trim() || '' } }
			});
			await persist();
		}
		_headerDrafts = { ..._headerDrafts, [serverId]: '' };
		setStatus('Header saved.');
	}

	async function addEnvVar(id: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		const name = `ENV_VAR_${Object.keys(s.env ?? {}).length + 1}`;
		const env = { ...(s.env ?? {}), [name]: { secretRef: '' } };
		updateServer(id, { env });
		secretFlags = { ...secretFlags, [id]: [...(secretFlags[id] ?? []), name] };
		await persist();
	}

	function removeEnvVar(id: string, name: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		const env = { ...(s.env ?? {}) };
		delete env[name];
		updateServer(id, { env: Object.keys(env).length > 0 ? env : undefined });
		secretFlags = {
			...secretFlags,
			[id]: (secretFlags[id] ?? []).filter((n) => n !== name)
		};
		void deleteMcpSecret(id, name);
		void persist();
	}

	async function renameEnvVar(id: string, oldName: string, newName: string) {
		const s = servers.find((x) => x.id === id);
		if (!s || !s.env || !newName.trim() || oldName === newName) return;
		const entry = s.env[oldName];
		if (!entry) return;
		const trimmedNew = newName.trim();
		const env: Record<string, { secretRef: string }> = {};
		for (const [k, v] of Object.entries(s.env)) {
			if (k === oldName) {
				env[trimmedNew] = { secretRef: entry.secretRef ? '' : v.secretRef };
			} else {
				env[k] = v;
			}
		}
		if (entry.secretRef) {
			await deleteMcpSecret(id, oldName);
			env[trimmedNew] = { secretRef: `mcp:${id}:${trimmedNew}` };
			secretDrafts = { ...secretDrafts, [id]: '' };
			secretFlags = {
				...secretFlags,
				[id]: (secretFlags[id] ?? []).map((n) => (n === oldName ? trimmedNew : n))
			};
			setStatus('Renamed — please re-enter the secret value.');
		}
		updateServer(id, { env });
		await persist();
	}

	async function saveEnvSecret(serverId: string, name: string, raw: string) {
		const trimmed = raw.trim();
		if (trimmed) {
			await setMcpSecret(serverId, name, trimmed);
		} else {
			await deleteMcpSecret(serverId, name);
		}
		const s = servers.find((x) => x.id === serverId);
		if (s && s.env && s.env[name]) {
			updateServer(serverId, {
				env: { ...s.env, [name]: { secretRef: `mcp:${serverId}:${name}` } }
			});
			void persist();
		}
		secretDrafts = { ...secretDrafts, [serverId]: 'cleared' };
		setStatus('Secret saved.');
	}

	async function testServerConnection(id: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		testing = { ...testing, [id]: true };
		testResults = { ...testResults, [id]: { error: '' } };
		const result = await testConnection(s);
		if ('tools' in result) {
			testResults = {
				...testResults,
				[id]: {
					tools: result.tools.length,
					resources: result.resources?.length,
					prompts: result.prompts?.length
				}
			};
			const parts = [`${result.tools.length} tools`];
			if (result.resources?.length) parts.push(`${result.resources.length} resources`);
			if (result.prompts?.length) parts.push(`${result.prompts.length} prompts`);
			setStatus(`Connected: ${parts.join(', ')} discovered.`);
		} else {
			testResults = { ...testResults, [id]: { error: result.error } };
			setStatus(`Connection failed: ${result.error}`);
		}
		testing = { ...testing, [id]: false };
	}

	function requestTrust(id: string) {
		trustingId = trustingId === id ? null : id;
	}

	async function confirmTrust(id: string) {
		const s = servers.find((x) => x.id === id);
		if (!s) return;
		const trusted = await trustNow(s);
		updateServer(id, { trustedHash: trusted.trustedHash });
		trustFlags = { ...trustFlags, [id]: true };
		trustingId = null;
		await persist();
		setStatus('Server trusted.');
	}

	function cancelTrust() {
		trustingId = null;
	}

	async function removeServer(id: string) {
		const s = servers.find((x) => x.id === id);
		const envNames = s ? Object.keys(s.env ?? {}) : [];
		const headerSecretNames = s
			? Object.entries(s.headers ?? {})
					.filter(([, v]) => v.secretRef)
					.map(([k]) => k)
			: [];
		await deleteServerSecrets(id, [...envNames, ...headerSecretNames]);
		servers = servers.filter((x) => x.id !== id);
		if (expandedId === id) expandedId = null;
		if (trustingId === id) trustingId = null;
		await persist();
	}

	async function handleImport() {
		importError = null;
		try {
			const imported = parseClaudeDesktopConfig(importDraft);
			for (const s of imported) {
				servers = [...servers, s];
			}
			await persist();
			importing = false;
			importDraft = '';
			setStatus(`Imported ${imported.length} server(s).`);
			for (const s of imported) {
				trustFlags[s.id] = await isTrusted(s);
				secretFlags[s.id] = [
					...Object.keys(s.env ?? {}),
					...Object.entries(s.headers ?? {})
						.filter(([, v]) => v.secretRef)
						.map(([k]) => k)
				];
			}
		} catch (err) {
			importError = err instanceof Error ? err.message : String(err);
		}
	}
	const CLAUDE_PLACEHOLDER =
		'{"mcpServers": {"my-server": {"command": "npx", "args": ["-y", "@example/server"]}}}';
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">MCP Servers</h2>
		<div class="flex items-center gap-1">
			{#if !adding}
				<Button
					variant="outline"
					size="sm"
					onclick={() => (adding = true)}
					disabled={loading || saving}
				>
					<Plus class="size-4" /> Add Server
				</Button>
			{/if}
			<Button
				variant="outline"
				size="sm"
				onclick={() => (importing = true)}
				disabled={loading || saving}
			>
				<ClipboardPaste class="size-4" /> Paste mcpServers JSON
			</Button>
		</div>
	</div>

	{#if status}
		<p class="text-xs text-muted-foreground" role="status">{status}</p>
	{/if}

	{#if adding}
		<div class="space-y-2 rounded-lg border border-border p-4">
			<p class="text-sm font-medium">Pick a template</p>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each MCP_SERVER_TEMPLATES as t (t.label)}
					{@const available = isTemplateAvailable(t)}
					<button
						type="button"
						class="rounded-md border border-input p-3 text-left text-sm transition-colors {available
							? 'bg-background hover:bg-accent cursor-pointer'
							: 'bg-muted/50 opacity-50 cursor-not-allowed'}"
						onclick={() => addFromTemplate(t)}
						disabled={!available}
						title={!available ? 'This template requires the Mayon server.' : undefined}
					>
						<div class="flex items-center justify-between gap-2">
							<span class="block font-medium">{t.label}</span>
							{#if t.platforms}
								<span
									class="flex items-center gap-0.5 text-xs text-muted-foreground"
									title={t.platforms.includes('web') && t.platforms.includes('desktop')
										? 'Available everywhere'
										: t.platforms.includes('desktop')
											? 'Requires server'
											: 'Web only'}
								>
									{#if t.platforms.includes('web') && t.platforms.includes('desktop')}
										<Monitor class="size-3" /><Globe class="size-3" />
									{:else if t.platforms.includes('desktop')}
										<Monitor class="size-3" />
									{:else}
										<Globe class="size-3" />
									{/if}
								</span>
							{/if}
						</div>
						<span class="block text-xs text-muted-foreground">{t.description}</span>
					</button>
				{/each}
			</div>
			<div class="flex justify-end">
				<Button variant="ghost" size="sm" onclick={() => (adding = false)}>Cancel</Button>
			</div>
		</div>
	{/if}

	{#if draftServer}
		{@const ds = draftServer}
		<div class="space-y-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
			<p class="text-sm font-medium text-blue-600 dark:text-blue-400">New Server (not yet saved)</p>
			<div class="space-y-3">
				<label class="space-y-1 text-xs text-muted-foreground">
					<span>Name</span>
					<input
						class={inputClass}
						value={ds.name}
						oninput={(e) => onDraftNameInput(e.currentTarget.value)}
						placeholder="Server name"
					/>
				</label>
				{#if ds.transport === 'stdio'}
					<div class="grid gap-2 sm:grid-cols-2">
						<label class="space-y-1 text-xs text-muted-foreground">
							<span>Command</span>
							<input
								class={inputClass}
								value={ds.command ?? ''}
								oninput={(e) => onDraftCommandInput(e.currentTarget.value)}
							/>
						</label>
						<label class="space-y-1 text-xs text-muted-foreground">
							<span>Arguments (space-separated)</span>
							<input
								class={inputClass}
								value={ds.args?.join(' ') ?? ''}
								oninput={(e) => onDraftArgsInput(e.currentTarget.value)}
							/>
						</label>
					</div>
					<label class="space-y-1 text-xs text-muted-foreground">
						<span>Working directory</span>
						<input
							class={inputClass}
							value={ds.cwd ?? ''}
							oninput={(e) => onDraftCwdInput(e.currentTarget.value)}
							placeholder="(default)"
						/>
					</label>
				{:else}
					<label class="space-y-1 text-xs text-muted-foreground">
						<span>Server URL</span>
						<input
							class={inputClass}
							value={ds.url ?? ''}
							oninput={(e) => onDraftUrlInput(e.currentTarget.value)}
							placeholder="https://..."
						/>
					</label>

					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Headers</span>
							<Button variant="ghost" size="sm" onclick={draftAddHeader}>
								<Plus class="size-3" /> Add
							</Button>
						</div>
						{#if ds.headers && Object.keys(ds.headers).length > 0}
							<div class="space-y-2">
								{#each Object.entries(ds.headers) as [name, entry] (name)}
									<div class="flex items-center gap-2">
										<input
											class="min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
											value={name}
											oninput={(e) => draftRenameHeader(name, e.currentTarget.value)}
											placeholder="Header-Name"
										/>
										<input
											class={inputClass}
											placeholder="value"
											value={entry.value ?? ''}
											oninput={(e) => onDraftHeaderValueInput(name, e.currentTarget.value)}
										/>
										<Button
											variant="ghost"
											size="icon"
											class="shrink-0"
											title="Remove header"
											onclick={() => draftRemoveHeader(name)}
										>
											<Trash2 class="size-3" />
										</Button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-muted-foreground">No headers configured.</p>
						{/if}
					</div>
				{/if}

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-xs text-muted-foreground">Environment Variables</span>
						<Button variant="ghost" size="sm" onclick={draftAddEnvVar}>
							<Plus class="size-3" /> Add
						</Button>
					</div>
					{#if ds.env && Object.keys(ds.env).length > 0}
						<div class="space-y-2">
							{#each Object.entries(ds.env) as [name, _entry] (name)}
								<div class="flex items-center gap-2">
									<input
										class="min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
										value={name}
										oninput={(e) => draftRenameEnvVar(name, e.currentTarget.value)}
										placeholder="VAR_NAME"
									/>
									{#if draftSecretDraft[name] !== undefined}
										<input
											type="password"
											class={inputClass}
											placeholder="paste value"
											value={draftSecretDraft[name]}
											oninput={(e) =>
												(draftSecretDraft = {
													...draftSecretDraft,
													[name]: e.currentTarget.value
												})}
										/>
									{:else}
										<input
											type="password"
											class={inputClass}
											disabled
											placeholder="•••••••• (set after creation)"
										/>
										<Button
											variant="outline"
											size="sm"
											onclick={() => {
												draftSecretDraft = { ...draftSecretDraft, [name]: '' };
											}}
										>
											Set
										</Button>
									{/if}
									<Button
										variant="ghost"
										size="icon"
										class="shrink-0"
										title="Remove variable"
										onclick={() => draftRemoveEnvVar(name)}
									>
										<Trash2 class="size-3" />
									</Button>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">No environment variables configured.</p>
					{/if}
				</div>

				<div class="grid gap-2 sm:grid-cols-2">
					<label class="space-y-1 text-xs text-muted-foreground">
						<span>Call timeout (ms)</span>
						<input
							type="number"
							class={inputClass}
							value={ds.callTimeoutMs ?? ''}
							oninput={(e) => onDraftTimeoutInput(e.currentTarget.value)}
							placeholder="30000"
						/>
					</label>
					<label class="space-y-1 text-xs text-muted-foreground">
						<span>Result cap (bytes)</span>
						<input
							type="number"
							class={inputClass}
							value={ds.resultCapBytes ?? ''}
							oninput={(e) => onDraftResultCapInput(e.currentTarget.value)}
							placeholder="262144"
						/>
					</label>
				</div>

				<div class="flex items-center gap-2">
					<Button variant="default" size="sm" onclick={confirmDraft}>
						<CheckCircle2 class="size-3" />
						Create Server
					</Button>
					<Button variant="ghost" size="sm" onclick={cancelDraft}>Cancel</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if servers.length === 0}
		<p
			class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
		>
			No MCP servers configured. Click "Add Server" to add one, or paste a Claude Desktop config.
		</p>
	{:else}
		<ul class="space-y-3">
			{#each servers as s (s.id)}
				{@const isExpanded = expandedId === s.id}
				{@const isTrustedServer = trustFlags[s.id] === true}
				{@const showTrustBanner = trustingId === s.id}
				<li class="space-y-3 rounded-lg border border-border p-4">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 space-y-0.5">
							<div class="flex items-center gap-2">
								<input
									class="bg-transparent text-sm font-semibold outline-none focus-visible:underline"
									value={s.name}
									oninput={(e) => onNameInput(s.id, e.currentTarget.value)}
									onchange={() => onNameChange(s.id)}
									aria-label="Server name"
								/>
								<span
									class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium {s.transport ===
									'stdio'
										? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
										: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'}"
								>
									{s.transport === 'stdio' ? 'stdio' : 'http'}
								</span>
								{#if isTrustedServer}
									<span
										class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
									>
										<CheckCircle2 class="size-3" /> trusted
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
									>
										<ShieldAlert class="size-3" /> untrusted
									</span>
								{/if}
								{#if s.enabled}
									<span
										class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
									>
										on
									</span>
								{:else}
									<span
										class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
									>
										off
									</span>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground">
								{#if s.command}
									{s.command}{s.args?.length ? ' ' + s.args.join(' ') : ''}
								{:else if s.url}
									{s.url}
								{/if}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Button
								variant={s.enabled ? 'outline' : 'ghost'}
								size="sm"
								onclick={() => toggleEnabled(s.id)}
								title={s.enabled ? 'Disable server' : 'Enable server'}
							>
								{#if s.enabled}
									<Unplug class="size-4" />
								{:else}
									<CheckCircle2 class="size-4" />
								{/if}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								title="Edit server"
								aria-label="Edit server"
								onclick={() => toggleExpand(s.id)}
							>
								<Edit3 class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								title="Delete server"
								aria-label="Delete server"
								onclick={() => removeServer(s.id)}
							>
								<Trash2 class="size-4" />
							</Button>
						</div>
					</div>

					{#if isExpanded}
						<div class="space-y-3 border-t border-border pt-3">
							{#if s.transport === 'stdio'}
								<div class="grid gap-2 sm:grid-cols-2">
									<label class="space-y-1 text-xs text-muted-foreground">
										<span>Command</span>
										<input
											class={inputClass}
											value={s.command ?? ''}
											oninput={(e) => onCommandInput(s.id, e.currentTarget.value)}
											onchange={() => commitField(s.id)}
										/>
									</label>
									<label class="space-y-1 text-xs text-muted-foreground">
										<span>Arguments (space-separated)</span>
										<input
											class={inputClass}
											value={s.args?.join(' ') ?? ''}
											oninput={(e) => onArgsInput(s.id, e.currentTarget.value)}
											onchange={() => commitField(s.id)}
										/>
									</label>
								</div>
								<label class="space-y-1 text-xs text-muted-foreground">
									<span>Working directory</span>
									<input
										class={inputClass}
										value={s.cwd ?? ''}
										oninput={(e) => onCwdInput(s.id, e.currentTarget.value)}
										onchange={() => commitField(s.id)}
										placeholder="(default)"
									/>
								</label>
							{:else}
								<label class="space-y-1 text-xs text-muted-foreground">
									<span>Server URL</span>
									<input
										class={inputClass}
										value={s.url ?? ''}
										oninput={(e) => onUrlInput(s.id, e.currentTarget.value)}
										onchange={() => commitField(s.id)}
									/>
								</label>

								<div class="space-y-2">
									<div class="flex items-center justify-between">
										<span class="text-xs text-muted-foreground">Headers</span>
										<Button variant="ghost" size="sm" onclick={() => addHeader(s.id)}>
											<Plus class="size-3" /> Add
										</Button>
									</div>
									{#if s.headers && Object.keys(s.headers).length > 0}
										<div class="space-y-2">
											{#each Object.entries(s.headers) as [name, entry] (name)}
												<div class="flex items-center gap-2">
													<input
														class="min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
														value={name}
														oninput={(e) => renameHeader(s.id, name, e.currentTarget.value)}
														placeholder="Header-Name"
													/>
													{#if entry.secretRef}
														{#if _headerDrafts[s.id]}
															<input
																type="password"
																class={inputClass}
																placeholder="paste value"
																value={_headerDrafts[s.id]}
																oninput={(e) =>
																	(_headerDrafts = {
																		..._headerDrafts,
																		[s.id]: e.currentTarget.value
																	})}
															/>
															<Button
																variant="outline"
																size="sm"
																onclick={() =>
																	saveHeaderSecret(s.id, name, _headerDrafts[s.id] ?? '')}
															>
																Save
															</Button>
														{:else}
															<input
																type="password"
																class={inputClass}
																disabled
																placeholder="•••••••• (saved)"
															/>
															<Button
																variant="outline"
																size="sm"
																onclick={() => {
																	_headerDrafts = { ..._headerDrafts, [s.id]: '' };
																}}
															>
																Replace
															</Button>
														{/if}
													{:else}
														<input
															class={inputClass}
															placeholder="value"
															value={entry.value ?? ''}
															oninput={(e) =>
																(_headerDrafts = {
																	..._headerDrafts,
																	[s.id]: e.currentTarget.value
																})}
														/>
														<Button
															variant="outline"
															size="sm"
															onclick={() => saveHeaderValue(s.id, name, _headerDrafts[s.id] ?? '')}
														>
															Set
														</Button>
													{/if}
													<Button
														variant="ghost"
														size="icon"
														class="shrink-0"
														title="Remove header"
														onclick={() => removeHeader(s.id, name)}
													>
														<Trash2 class="size-3" />
													</Button>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">No headers configured.</p>
									{/if}
								</div>
							{/if}

							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-xs text-muted-foreground">Environment Variables</span>
									<Button variant="ghost" size="sm" onclick={() => addEnvVar(s.id)}>
										<Plus class="size-3" /> Add
									</Button>
								</div>
								{#if s.env && Object.keys(s.env).length > 0}
									<div class="space-y-2">
										{#each Object.entries(s.env) as [name, _entry] (name)}
											<div class="flex items-center gap-2">
												<input
													class="min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring"
													value={name}
													oninput={(e) => renameEnvVar(s.id, name, e.currentTarget.value)}
													placeholder="VAR_NAME"
												/>
												{#if secretDrafts[s.id] && secretDrafts[s.id] !== 'cleared'}
													<input
														type="password"
														class={inputClass}
														placeholder="paste value"
														value={secretDrafts[s.id]}
														oninput={(e) =>
															(secretDrafts = {
																...secretDrafts,
																[s.id]: e.currentTarget.value
															})}
													/>
													<Button
														variant="outline"
														size="sm"
														onclick={() => {
															saveEnvSecret(s.id, name, secretDrafts[s.id] ?? '');
														}}
													>
														Save
													</Button>
												{:else}
													<input
														type="password"
														class={inputClass}
														disabled
														placeholder="•••••••• (saved)"
													/>
													<Button
														variant="outline"
														size="sm"
														onclick={() => {
															secretDrafts = { ...secretDrafts, [s.id]: '' };
														}}
													>
														Replace
													</Button>
												{/if}
												<Button
													variant="ghost"
													size="icon"
													class="shrink-0"
													title="Remove variable"
													onclick={() => removeEnvVar(s.id, name)}
												>
													<Trash2 class="size-3" />
												</Button>
											</div>
										{/each}
									</div>
								{:else}
									<p class="text-xs text-muted-foreground">No environment variables configured.</p>
								{/if}
							</div>

							<div class="grid gap-2 sm:grid-cols-2">
								<label class="space-y-1 text-xs text-muted-foreground">
									<span>Call timeout (ms)</span>
									<input
										type="number"
										class={inputClass}
										value={s.callTimeoutMs ?? ''}
										oninput={(e) => onTimeoutInput(s.id, e.currentTarget.value)}
										onchange={() => commitField(s.id)}
										placeholder="30000"
									/>
								</label>
								<label class="space-y-1 text-xs text-muted-foreground">
									<span>Result cap (bytes)</span>
									<input
										type="number"
										class={inputClass}
										value={s.resultCapBytes ?? ''}
										oninput={(e) => onResultCapInput(s.id, e.currentTarget.value)}
										onchange={() => commitField(s.id)}
										placeholder="262144"
									/>
								</label>
							</div>

							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => testServerConnection(s.id)}
									disabled={testing[s.id]}
								>
									<Wrench class="size-3" />
									{testing[s.id] ? 'Testing…' : 'Test Connection'}
								</Button>
								{#if !isTrustedServer}
									<Button variant="outline" size="sm" onclick={() => requestTrust(s.id)}>
										<ShieldAlert class="size-3" />
										Trust Server
									</Button>
								{/if}
							</div>

							{#if testResults[s.id]}
								{@const result = testResults[s.id]}
								<div
									class="rounded-md p-2 text-xs {'tools' in result
										? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
										: 'bg-red-500/10 text-red-600 dark:text-red-400'}"
								>
									{#if 'tools' in result}
										<CheckCircle2 class="size-3 inline" /> Connected: {result.tools} tool(s) discovered.
										{#if result.resources}
											<span class="ml-1">{result.resources} resource(s)</span>
										{/if}
										{#if result.prompts}
											<span class="ml-1">{result.prompts} prompt(s)</span>
										{/if}
									{:else}
										<ShieldAlert class="size-3 inline" />
										{result.error}
										{#if result.corsBlocked}
											<span class="block mt-1 opacity-80">
												Start the Mayon server (<code>docker compose up</code>) to route this
												request and avoid CORS.
											</span>
										{/if}
									{/if}
								</div>
							{/if}

							{#if showTrustBanner}
								<div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
									<p class="text-xs font-medium text-amber-600 dark:text-amber-400">
										<ShieldAlert class="size-3 inline" /> Trust this server?
									</p>
									<p class="text-xs text-muted-foreground">
										Review the details below. Trusting allows this server to run on your machine.
									</p>
									<div class="space-y-1 rounded bg-background/50 p-2 font-mono text-xs">
										{#if s.command}
											<p><span class="text-muted-foreground">Command:</span> {s.command}</p>
										{/if}
										{#if s.args?.length}
											<p><span class="text-muted-foreground">Args:</span> {s.args.join(' ')}</p>
										{/if}
										{#if s.cwd}
											<p><span class="text-muted-foreground">CWD:</span> {s.cwd}</p>
										{/if}
										{#if s.url}
											<p><span class="text-muted-foreground">URL:</span> {s.url}</p>
										{/if}
										{#if s.env && Object.keys(s.env).length > 0}
											<p>
												<span class="text-muted-foreground">Env vars:</span>
												{Object.keys(s.env).join(', ')}
											</p>
										{/if}
										{#if s.headers && Object.keys(s.headers).length > 0}
											<p>
												<span class="text-muted-foreground">Headers:</span>
												{Object.keys(s.headers).join(', ')}
											</p>
										{/if}
										{#if s.transport === 'http' && Object.entries(s.headers ?? {}).some(([, v]) => v.secretRef)}
											<p class="text-amber-500/80">
												Header secrets are read into the browser to send each request (same as
												provider API keys in the browser). Use a stdio server on desktop to keep
												secrets out of the page.
											</p>
										{/if}
									</div>
									<div class="flex items-center gap-2">
										<Button variant="outline" size="sm" onclick={() => confirmTrust(s.id)}>
											Trust this server
										</Button>
										<Button variant="ghost" size="sm" onclick={cancelTrust}>Cancel</Button>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Dialog bind:open={importing}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Import Claude Desktop Config</DialogTitle>
			<DialogDescription>
				Paste your Claude Desktop mcpServers JSON to import server configurations.
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-2">
			<textarea
				class="min-h-[200px] w-full rounded-md border border-input bg-background p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				placeholder={CLAUDE_PLACEHOLDER}
				bind:value={importDraft}></textarea>
			{#if importError}
				<p class="text-xs text-red-600 dark:text-red-400">{importError}</p>
			{/if}
		</div>
		<DialogFooter>
			<Button variant="ghost" size="sm" onclick={() => (importing = false)}>Cancel</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => handleImport()}
				disabled={!importDraft.trim()}
			>
				Import
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
