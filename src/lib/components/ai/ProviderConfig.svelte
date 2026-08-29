<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckCircle2, ChevronRight, KeyRound, Plus, Trash2 } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible/index.js';
	import { ModelSelect } from '$lib/components/ai/model-select/index.js';
	import CopilotAuthDialog from '$lib/components/ai/copilot-auth-dialog.svelte';
	import { PROVIDER_TEMPLATES, type ProviderTemplate } from '$lib/ai/registry';
	import { describeDialect, resolveRequestSettings, validateExtraBody } from '$lib/ai/dialects';
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
	import type {
		HazardId,
		ProviderConfig,
		ReasoningEffort,
		SamplingRequestDefaults
	} from '$lib/ai/types';
	import { CopilotAuthRequiredError } from '$lib/ai/types';
	import { uuid } from '$lib/db/ids';
	import { chatStore } from '$lib/stores/chat.svelte';

	// API keys live in the runtime KeyStore (IndexedDB) — not the local settings store.
	// The "replace key" affordance below never echoes a stored key back; it only
	// writes/deletes.

	// Optional extra sections rendered inside the page's column (e.g. the lab
	// prompt override). Keeps the page chrome (title + max-width + padding) in
	// one place.
	let { children, header }: { children?: Snippet; header?: Snippet } = $props();

	let providers = $state<ProviderConfig[]>([]);
	let activeId = $state<string | null>(null);
	let keyFlags = $state<Record<string, boolean>>({}); // id → has a key set
	let keyDrafts = $state<Record<string, string>>({}); // id → unsaved key input value
	let discovering = $state<Record<string, boolean>>({}); // id → model list refreshing
	// GitHub Copilot device-flow connector: which provider's auth dialog is open,
	// and the GitHub login shown on the connected line (local state only — the
	// KeyStore grant is the only persisted secret).
	let copilotAuthFor = $state<string | null>(null);
	let copilotLogins = $state<Record<string, string>>({});
	// needs-reconnect (US2): latched when a chat turn fails with
	// CopilotAuthRequiredError for this provider; cleared by a successful
	// reconnect. Conversation content is untouched (FR-008) — this is a badge.
	let needsReconnect = $state<Record<string, boolean>>({});
	let loading = $state(true);
	let saving = $state(false);
	let status = $state<string | null>(null);

	// "Add provider" UI state.
	let adding = $state(false);

	let samplingDrafts = $state<Record<string, Record<string, string>>>({});
	let samplingErrors = $state<Record<string, Record<string, string>>>({});
	let extraBodyDrafts = $state<Record<string, string>>({});
	let extraBodyErrors = $state<Record<string, string[]>>({});
	let previewEfforts = $state<Record<string, ReasoningEffort>>({});

	const inputClass =
		'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
	const textareaClass =
		'min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

	type SamplingField = {
		key: keyof SamplingRequestDefaults;
		label: string;
		kind: 'number' | 'stopSequences';
		min?: number;
		max?: number;
		integer?: boolean;
	};

	const SAMPLING_FIELDS: SamplingField[] = [
		{ key: 'temperature', label: 'Temperature', kind: 'number', min: 0, max: 2 },
		{ key: 'topP', label: 'Top P', kind: 'number', min: 0, max: 1 },
		{ key: 'maxOutputTokens', label: 'Max output tokens', kind: 'number', min: 1, integer: true },
		{ key: 'stopSequences', label: 'Stop sequences', kind: 'stopSequences' },
		{ key: 'seed', label: 'Seed', kind: 'number', integer: true },
		{ key: 'frequencyPenalty', label: 'Frequency penalty', kind: 'number', min: -2, max: 2 },
		{ key: 'presencePenalty', label: 'Presence penalty', kind: 'number', min: -2, max: 2 }
	];

	const HAZARD_COPY: Record<HazardId, string> = {
		'locks-sampling': 'This model fixes temperature/top_p — sampling settings are disabled.',
		'thinking-ignores-sampling': 'Sampling parameters are ignored while thinking is on.',
		'thinking-rejects-sampling':
			'Anthropic rejects non-default sampling while thinking — expect an error.',
		'cannot-disable-thinking': "This model always reasons; effort 'off' cannot disable it.",
		'reasoning-eats-token-cap':
			'Reasoning tokens count toward max output tokens — low caps can return empty replies.'
	};

	onMount(load);

	// Chat-side bridge: the chat store keeps the raw mapped error of the last
	// failed turn; an auth-required failure latches the needs-reconnect badge
	// on the matching provider card (reads `lastMappedError` only — no loop).
	$effect(() => {
		const err = chatStore.lastMappedError;
		if (err instanceof CopilotAuthRequiredError && err.providerId) {
			needsReconnect[err.providerId] = true;
		}
	});

	async function load() {
		loading = true;
		providers = await listProviders();
		activeId = await getActiveProviderId();
		keyFlags = {};
		samplingDrafts = {};
		samplingErrors = {};
		extraBodyDrafts = {};
		extraBodyErrors = {};
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
			discoverable: t.discoverable,
			toolCapability: t.toolCapability
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
				if (!merged.includes(p.defaultModel)) {
					// FR-011: point at the picker — never auto-mutate the user's choice.
					status = `Saved model '${p.defaultModel}' is no longer offered — pick another.`;
				} else if (!silent) {
					status = `Found ${discovered.length} models.`;
				}
			} else if (!silent) {
				status = 'No models returned. Check the base URL / API key.';
			}
		} catch (err) {
			// Best-effort: the stored fallback list stays intact on failure.
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

	function parseSamplingValue(
		field: SamplingField,
		raw: string
	): { ok: true; value?: number | string[] } | { ok: false; error: string } {
		const trimmed = raw.trim();
		if (trimmed === '') return { ok: true };
		if (field.kind === 'stopSequences') {
			const items = trimmed
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			if (items.length > 16) return { ok: false, error: 'At most 16 stop sequences' };
			return { ok: true, value: items.length > 0 ? items : undefined };
		}
		const num = Number(trimmed);
		if (!Number.isFinite(num)) return { ok: false, error: 'Enter a number' };
		if (field.integer && !Number.isInteger(num)) return { ok: false, error: 'Must be an integer' };
		if (field.min !== undefined && num < field.min) {
			return {
				ok: false,
				error:
					field.max !== undefined
						? `Must be between ${field.min} and ${field.max}`
						: `Must be ≥ ${field.min}`
			};
		}
		if (field.max !== undefined && num > field.max) {
			return {
				ok: false,
				error:
					field.min !== undefined
						? `Must be between ${field.min} and ${field.max}`
						: `Must be ≤ ${field.max}`
			};
		}
		return { ok: true, value: num };
	}

	function samplingDisplay(p: ProviderConfig, field: SamplingField): string {
		const draft = samplingDrafts[p.id]?.[field.key];
		if (draft !== undefined) return draft;
		const value = p.requestDefaults?.[field.key];
		if (value === undefined) return '';
		return field.kind === 'stopSequences' ? (value as string[]).join(', ') : String(value);
	}

	function applySamplingField(
		p: ProviderConfig,
		field: SamplingField,
		parsed: number | string[] | undefined
	) {
		const next: SamplingRequestDefaults = { ...(p.requestDefaults ?? {}) };
		if (parsed === undefined) delete next[field.key];
		else (next as Record<string, unknown>)[field.key] = parsed;
		updateField(p.id, { requestDefaults: next });
	}

	function onSamplingInput(p: ProviderConfig, field: SamplingField, raw: string) {
		samplingDrafts = {
			...samplingDrafts,
			[p.id]: { ...samplingDrafts[p.id], [field.key]: raw }
		};
		const result = parseSamplingValue(field, raw);
		const errors = { ...samplingErrors[p.id] };
		if (result.ok) {
			delete errors[field.key];
			samplingErrors = { ...samplingErrors, [p.id]: errors };
			applySamplingField(p, field, result.value);
		} else {
			errors[field.key] = result.error;
			samplingErrors = { ...samplingErrors, [p.id]: errors };
		}
	}

	function onSamplingChange(p: ProviderConfig, field: SamplingField) {
		const raw = samplingDrafts[p.id]?.[field.key];
		if (raw === undefined) return;
		if (parseSamplingValue(field, raw).ok) commit(p.id);
	}

	function extraBodyDisplay(p: ProviderConfig): string {
		const draft = extraBodyDrafts[p.id];
		if (draft !== undefined) return draft;
		return p.extraBody ? JSON.stringify(p.extraBody, null, 2) : '';
	}

	function onExtraBodyInput(id: string, raw: string) {
		extraBodyDrafts = { ...extraBodyDrafts, [id]: raw };
	}

	function onExtraBodyChange(p: ProviderConfig) {
		const raw = extraBodyDrafts[p.id];
		if (raw === undefined) return;
		if (raw.trim() === '') {
			extraBodyErrors = { ...extraBodyErrors, [p.id]: [] };
			updateField(p.id, { extraBody: undefined });
			commit(p.id);
			return;
		}
		const result = validateExtraBody(raw);
		if (result.ok) {
			extraBodyErrors = { ...extraBodyErrors, [p.id]: [] };
			updateField(p.id, { extraBody: result.value });
			commit(p.id);
		} else {
			extraBodyErrors = { ...extraBodyErrors, [p.id]: result.errors };
		}
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

	function onCopilotAuthSuccess(id: string, login?: string) {
		keyFlags = { ...keyFlags, [id]: true };
		copilotLogins = { ...copilotLogins, [id]: login ?? '' };
		const reconnect = { ...needsReconnect };
		delete reconnect[id];
		needsReconnect = reconnect;
		chatStore.clearAuthRequiredError(id);
		status = 'GitHub account connected.';
		// A fresh grant unlocks authenticated discovery; refresh the catalog.
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
		const sampling = { ...samplingDrafts };
		const samplingErr = { ...samplingErrors };
		const extraDrafts = { ...extraBodyDrafts };
		const extraErr = { ...extraBodyErrors };
		const efforts = { ...previewEfforts };
		const logins = { ...copilotLogins };
		const reconnect = { ...needsReconnect };
		delete flags[id];
		delete drafts[id];
		delete probing[id];
		delete sampling[id];
		delete samplingErr[id];
		delete extraDrafts[id];
		delete extraErr[id];
		delete efforts[id];
		delete logins[id];
		delete reconnect[id];
		keyFlags = flags;
		keyDrafts = drafts;
		discovering = probing;
		samplingDrafts = sampling;
		samplingErrors = samplingErr;
		extraBodyDrafts = extraDrafts;
		extraBodyErrors = extraErr;
		previewEfforts = efforts;
		copilotLogins = logins;
		needsReconnect = reconnect;
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
			Configure AI providers. Provider handles persist locally; API keys are stored in IndexedDB,
			never in the local settings store.
		</p>
	</div>

	{@render header?.()}

	{#if status}
		<p class="text-xs text-muted-foreground" role="status">{status}</p>
	{/if}

	<section id="providers" class="scroll-mt-4 space-y-3">
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
					{@const dialect = describeDialect(p, p.defaultModel)}
					{@const samplingLocked = dialect?.locksSampling === true}
					{@const preview = resolveRequestSettings(p, p.defaultModel, previewEfforts[p.id] ?? 'on')}
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

						<label class="space-y-1 text-xs text-muted-foreground">
							<span>Tool capability</span>
							<select
								class={inputClass}
								value={p.toolCapability ?? 'auto'}
								onchange={(e) => {
									updateField(p.id, {
										toolCapability: e.currentTarget.value as 'auto' | 'on' | 'off'
									});
									commit(p.id);
								}}
							>
								<option value="auto">Auto (provider default)</option>
								<option value="on">On</option>
								<option value="off">Off</option>
							</select>
						</label>

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

						<Collapsible>
							<CollapsibleTrigger
								class="flex w-fit cursor-pointer select-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
							>
								Advanced
								<ChevronRight class="size-3" />
							</CollapsibleTrigger>
							<CollapsibleContent>
								<div class="space-y-3 pt-1">
									{#if dialect?.hazards && dialect.hazards.length > 0}
										<ul class="space-y-0.5">
											{#each dialect.hazards as hazard (hazard)}
												<li class="text-xs text-amber-600 dark:text-amber-400">
													{HAZARD_COPY[hazard]}
												</li>
											{/each}
										</ul>
									{/if}

									<div class="grid gap-2 sm:grid-cols-2">
										{#each SAMPLING_FIELDS as field (field.key)}
											<label class="space-y-1 text-xs text-muted-foreground">
												<span>{field.label}</span>
												<input
													type="text"
													inputmode={field.kind === 'stopSequences' ? 'text' : 'decimal'}
													class="{inputClass} disabled:cursor-not-allowed disabled:opacity-50"
													placeholder={field.kind === 'stopSequences' ? 'comma-separated' : ''}
													value={samplingDisplay(p, field)}
													disabled={samplingLocked}
													oninput={(e) => onSamplingInput(p, field, e.currentTarget.value)}
													onchange={() => onSamplingChange(p, field)}
												/>
												{#if samplingErrors[p.id]?.[field.key]}
													<span class="text-xs text-destructive">
														{samplingErrors[p.id][field.key]}
													</span>
												{/if}
											</label>
										{/each}
									</div>

									<label class="space-y-1 text-xs text-muted-foreground">
										<span>Extra request body (JSON)</span>
										<textarea
											class={textareaClass}
											placeholder="Additional JSON keys for this provider"
											value={extraBodyDisplay(p)}
											oninput={(e) => onExtraBodyInput(p.id, e.currentTarget.value)}
											onchange={() => onExtraBodyChange(p)}></textarea>
										{#if (extraBodyErrors[p.id] ?? []).length > 0}
											<ul class="space-y-0.5">
												{#each extraBodyErrors[p.id] as err (err)}
													<li class="text-xs text-destructive">{err}</li>
												{/each}
											</ul>
										{/if}
									</label>

									{#if preview.droppedExtraKeys.length > 0}
										<p class="text-xs text-amber-600 dark:text-amber-400">
											Not forwarded by this provider kind: {preview.droppedExtraKeys.join(', ')}
										</p>
									{/if}

									<div class="space-y-1">
										<div class="flex flex-wrap items-center justify-between gap-2">
											<span class="text-xs text-muted-foreground">
												Resolved request preview (read-only)
											</span>
											{#if dialect?.hazards && dialect.hazards.length > 0}
												<div class="flex flex-wrap gap-1">
													{#each dialect.hazards as hazard (hazard)}
														<span
															class="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
														>
															{hazard}
														</span>
													{/each}
												</div>
											{/if}
										</div>
										<div class="flex items-start gap-2">
											<label class="w-28 shrink-0 space-y-1 text-xs text-muted-foreground">
												<span>Preview effort</span>
												<select
													class={inputClass}
													value={previewEfforts[p.id] ?? 'on'}
													onchange={(e) =>
														(previewEfforts = {
															...previewEfforts,
															[p.id]: e.currentTarget.value as ReasoningEffort
														})}
												>
													<option value="off">Off</option>
													<option value="on">On</option>
													<option value="deep">Deep</option>
												</select>
											</label>
											<pre
												class="max-h-60 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{JSON.stringify(
													{
														callSettings: preview.callSettings,
														providerOptions: preview.providerOptions
													},
													null,
													2
												)}</pre>
										</div>
									</div>
								</div>
							</CollapsibleContent>
						</Collapsible>

						{#if needsKey && p.kind === 'github-copilot'}
							<div class="space-y-1">
								<span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
									<KeyRound class="size-3" />
									GitHub account
								</span>
								{#if keyFlags[p.id]}
									<div class="flex items-center gap-2">
										{#if needsReconnect[p.id]}
											<span
												class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
												role="status"
											>
												Reconnect needed
											</span>
											<Button variant="outline" size="sm" onclick={() => (copilotAuthFor = p.id)}>
												Reconnect GitHub
											</Button>
										{:else}
											<span
												class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
												role="status"
											>
												<CheckCircle2 class="size-3" />
												Connected{copilotLogins[p.id] ? ` · ${copilotLogins[p.id]}` : ''}
											</span>
											<Button variant="outline" size="sm" onclick={() => (copilotAuthFor = p.id)}>
												Reconnect
											</Button>
										{/if}
									</div>
								{:else}
									<div>
										<Button variant="outline" size="sm" onclick={() => (copilotAuthFor = p.id)}>
											Connect GitHub account
										</Button>
									</div>
								{/if}
							</div>
						{:else if needsKey}
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

	{#if copilotAuthFor}
		{@const pid = copilotAuthFor}
		<CopilotAuthDialog
			providerId={pid}
			open
			onSuccess={(login) => onCopilotAuthSuccess(pid, login)}
			onClose={() => (copilotAuthFor = null)}
		/>
	{/if}

	{@render children?.()}
</div>
