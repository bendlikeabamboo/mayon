<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckCircle2, KeyRound, Plus, Trash2 } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import ModelSelect from '$lib/components/ai/ModelSelect.svelte';
	import { PROVIDER_TEMPLATES, type ProviderTemplate } from '$lib/ai/registry';
	import {
		deleteProviderKey,
		discoverProviderModels,
		getActiveProviderId,
		hasProviderKey,
		kindRequiresKey,
		listProviders,
		saveProviders,
		setActiveProvider,
		setProviderKey
	} from '$lib/ai/client';
	import type { ProviderConfig } from '$lib/ai/types';
	import { uuid } from '$lib/db/ids';

	// API keys live in the runtime KeyStore — the OS keychain on desktop (plaintext
	// never enters JS), IndexedDB in the browser — not the local settings store.
	// The "replace key" affordance below never echoes a stored key back; it only
	// writes/deletes.

	// Optional extra sections rendered inside the page's column (e.g. the lab
	// prompt override). Keeps the page chrome (title + max-width + padding) in
	// one place.
	let { children }: { children?: Snippet } = $props();

	let providers = $state<ProviderConfig[]>([]);
	let activeId = $state<string | null>(null);
	let keyFlags = $state<Record<string, boolean>>({}); // id → has a key set
	let keyDrafts = $state<Record<string, string>>({}); // id → unsaved key input value
	let discovering = $state<Record<string, boolean>>({}); // id → model list refreshing
	let loading = $state(true);
	let saving = $state(false);
	let status = $state<string | null>(null);

	// "Add provider" UI state.
	let adding = $state(false);

	const inputClass =
		'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

	onMount(load);

	async function load() {
		loading = true;
		providers = await listProviders();
		activeId = await getActiveProviderId();
		keyFlags = {};
		for (const p of providers) {
			if (kindRequiresKey(p)) keyFlags[p.id] = await hasProviderKey(p.id);
		}
		loading = false;
		// Keep gateway catalogs fresh: discover in the background for providers
		// that can (best-effort, silent — failures don't surface here).
		for (const p of providers) {
			if (p.discoverable && (!kindRequiresKey(p) || keyFlags[p.id])) {
				void refreshModels(p.id, { silent: true });
			}
		}
	}

	async function persist(next: ProviderConfig[]) {
		saving = true;
		status = null;
		try {
			providers = next;
			await saveProviders(next);
			status = 'Saved.';
		} catch (err) {
			status = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			saving = false;
		}
	}

	function addFromTemplate(t: ProviderTemplate) {
		const id = uuid();
		const config: ProviderConfig = {
			id,
			kind: t.kind,
			name: t.label,
			baseUrl: t.baseUrl,
			defaultModel: t.defaultModel,
			models: [...t.models],
			discoverable: t.discoverable
		};
		const next = [...providers, config];
		adding = false;
		void persist(next).then(() => {
			// First provider becomes active automatically.
			if (next.length === 1) void activate(id);
			// Auto-discover the catalog for gateways (best-effort; works pre-key
			// for public endpoints, and is re-run after a key is saved).
			if (config.discoverable) void refreshModels(id, { silent: true });
		});
	}

	function updateField(id: string, patch: Partial<ProviderConfig>) {
		providers = providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
	}

	function commit(_id: string) {
		void persist(providers);
	}

	function onSelectModel(id: string, model: string) {
		updateField(id, { defaultModel: model });
		commit(id);
	}

	/**
	 * Fetch the live model catalog for a discoverable gateway and merge it into
	 * the stored config (discovered IDs first, any manual additions preserved).
	 * Best-effort: `silent` suppresses status messages (used on load/add).
	 */
	async function refreshModels(id: string, { silent = false }: { silent?: boolean } = {}) {
		const p = providers.find((x) => x.id === id);
		if (!p || !p.discoverable) return;
		discovering = { ...discovering, [id]: true };
		if (!silent) status = 'Discovering models…';
		try {
			const discovered = await discoverProviderModels(p);
			if (discovered.length > 0) {
				const merged = [...discovered, ...p.models.filter((m) => !discovered.includes(m))];
				providers = providers.map((x) => (x.id === id ? { ...x, models: merged } : x));
				await saveProviders(providers);
				if (!silent) status = `Found ${discovered.length} models.`;
			} else if (!silent) {
				status = 'No models returned. Check the base URL / API key.';
			}
		} catch (err) {
			if (!silent) status = `Discovery failed: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			discovering = { ...discovering, [id]: false };
		}
	}

	function modelsText(p: ProviderConfig): string {
		return p.models.join(', ');
	}

	function onModelsInput(id: string, raw: string) {
		const models = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		updateField(id, { models });
	}

	async function saveKey(id: string, raw: string) {
		const trimmed = raw.trim();
		if (trimmed) {
			await setProviderKey(id, trimmed);
			keyFlags = { ...keyFlags, [id]: true };
		} else {
			await deleteProviderKey(id);
			keyFlags = { ...keyFlags, [id]: false };
		}
		keyDrafts = { ...keyDrafts, [id]: '' };
		status = 'Key saved.';
		// A freshly-saved key unlocks authenticated discovery; refresh the catalog.
		const p = providers.find((x) => x.id === id);
		if (p?.discoverable) void refreshModels(id);
	}

	async function activate(id: string) {
		await setActiveProvider(id);
		activeId = id;
		status = 'Active provider set.';
	}

	async function remove(id: string) {
		await deleteProviderKey(id);
		const next = providers.filter((p) => p.id !== id);
		await persist(next);
		// Drop any cached key state for the removed provider.
		const flags = { ...keyFlags };
		const drafts = { ...keyDrafts };
		const probing = { ...discovering };
		delete flags[id];
		delete drafts[id];
		delete probing[id];
		keyFlags = flags;
		keyDrafts = drafts;
		discovering = probing;
		if (activeId === id) {
			activeId = next.length > 0 ? next[0].id : null;
			await setActiveProvider(activeId);
		}
	}
</script>

<svelte:head>
	<title>Settings — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
		<p class="text-sm text-muted-foreground">
			Configure AI providers. Provider handles persist locally; API keys are stored in the OS
			keychain (desktop) or IndexedDB (browser), never in the local settings store.
		</p>
	</div>

	{#if status}
		<p class="text-xs text-muted-foreground" role="status">{status}</p>
	{/if}

	<section class="space-y-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Providers</h2>
			{#if !adding}
				<Button
					variant="outline"
					size="sm"
					onclick={() => (adding = true)}
					disabled={loading || saving}
				>
					<Plus class="size-4" /> Add provider
				</Button>
			{/if}
		</div>

		{#if adding}
			<div class="space-y-2 rounded-lg border border-border p-4">
				<p class="text-sm font-medium">Pick a template</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each PROVIDER_TEMPLATES as t (t.label)}
						<button
							type="button"
							class="rounded-md border border-input bg-background p-3 text-left text-sm transition-colors hover:bg-accent"
							onclick={() => addFromTemplate(t)}
						>
							<span class="block font-medium">{t.label}</span>
							<span class="block text-xs text-muted-foreground">{t.description}</span>
						</button>
					{/each}
				</div>
				<div class="flex justify-end">
					<Button variant="ghost" size="sm" onclick={() => (adding = false)}>Cancel</Button>
				</div>
			</div>
		{/if}

		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if providers.length === 0}
			<p
				class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
			>
				No providers yet. Click “Add provider” to configure one.
			</p>
		{:else}
			<ul class="space-y-3">
				{#each providers as p (p.id)}
					{@const isActive = p.id === activeId}
					{@const needsKey = kindRequiresKey(p)}
					<li class="space-y-3 rounded-lg border border-border p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0 space-y-0.5">
								<div class="flex items-center gap-2">
									<input
										class="bg-transparent text-sm font-semibold outline-none focus-visible:underline"
										value={p.name}
										oninput={(e) => updateField(p.id, { name: e.currentTarget.value })}
										onchange={() => commit(p.id)}
										aria-label="Provider name"
									/>
									{#if isActive}
										<span
											class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
										>
											<CheckCircle2 class="size-3" /> active
										</span>
									{/if}
								</div>
								<p class="text-xs text-muted-foreground">{p.kind}</p>
							</div>
							<div class="flex shrink-0 items-center gap-1">
								{#if !isActive}
									<Button variant="ghost" size="sm" onclick={() => activate(p.id)}
										>Set active</Button
									>
								{/if}
								<Button
									variant="ghost"
									size="icon"
									title="Delete provider"
									aria-label="Delete provider"
									onclick={() => remove(p.id)}
								>
									<Trash2 class="size-4" />
								</Button>
							</div>
						</div>

						<div class="grid gap-2 sm:grid-cols-2">
							<label class="space-y-1 text-xs text-muted-foreground">
								<span>Base URL</span>
								<input
									class={inputClass}
									value={p.baseUrl}
									oninput={(e) => updateField(p.id, { baseUrl: e.currentTarget.value })}
									onchange={() => commit(p.id)}
								/>
							</label>
							<div class="space-y-1">
								<span class="block text-xs text-muted-foreground">Default model</span>
								{#if p.discoverable}
									<ModelSelect
										models={p.models}
										value={p.defaultModel}
										discoverable
										discovering={discovering[p.id] === true}
										onselect={(m) => onSelectModel(p.id, m)}
										onrefresh={() => void refreshModels(p.id)}
									/>
									<p class="text-xs text-muted-foreground">
										{p.models.length} models
										{discovering[p.id] ? ' · refreshing…' : ' · click ⟳ to refresh'}
									</p>
								{:else}
									<select
										class={inputClass}
										value={p.defaultModel}
										onchange={(e) => {
											updateField(p.id, { defaultModel: e.currentTarget.value });
											commit(p.id);
										}}
									>
										{#each p.models as m (m)}
											<option value={m}>{m}</option>
										{/each}
									</select>
								{/if}
							</div>
						</div>

						{#if !p.discoverable}
							<label class="space-y-1 text-xs text-muted-foreground">
								<span>Models (comma-separated)</span>
								<input
									class={inputClass}
									value={modelsText(p)}
									oninput={(e) => onModelsInput(p.id, e.currentTarget.value)}
									onchange={() => commit(p.id)}
								/>
							</label>
						{/if}

						{#if needsKey}
							<label class="space-y-1 text-xs text-muted-foreground">
								<span class="inline-flex items-center gap-1">
									<KeyRound class="size-3" />
									{keyFlags[p.id] ? 'Replace API key (stored locally)' : 'API key (stored locally)'}
								</span>
								<div class="flex gap-2">
									<input
										type="password"
										class={inputClass}
										placeholder={keyFlags[p.id] ? '•••••••• (saved)' : 'paste key'}
										value={keyDrafts[p.id] ?? ''}
										oninput={(e) => (keyDrafts = { ...keyDrafts, [p.id]: e.currentTarget.value })}
									/>
									<Button
										variant="outline"
										size="sm"
										onclick={() => void saveKey(p.id, keyDrafts[p.id] ?? '')}
									>
										Save key
									</Button>
								</div>
							</label>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{@render children?.()}
</div>
