<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		TelemetryCaptureMode,
		TelemetryConfig,
		TelemetryConfigInput,
		TelemetryStatus
	} from '@mayon/shared';
	import { Button } from '#lib/components/ui/button/index.js';
	import { serverClient } from '#lib/services/client.js';
	import { telemetryState } from '#lib/telemetry/state.svelte.js';

	const MODES: ReadonlyArray<{
		id: TelemetryCaptureMode;
		label: string;
		leaves: string;
		stays: string;
	}> = [
		{
			id: 'content',
			label: 'Full content',
			leaves:
				'Your prompts and the model’s replies, plus model, token usage, timing, outcome, and conversation linkage.',
			stays:
				'Your AI provider API keys (never included in records) and the Langfuse secret key (server env only).'
		},
		{
			id: 'metadata',
			label: 'Metadata only',
			leaves:
				'Model, token usage, timing, outcome, and conversation linkage only — no conversation text of any kind.',
			stays: 'All of your prompts and replies; they never leave Mayon in this mode.'
		}
	];

	let loaded = $state(false);
	let enabled = $state(false);
	let host = $state('');
	let publicKey = $state('');
	let captureMode = $state<TelemetryCaptureMode>('content');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let deliveryStatus = $state<TelemetryStatus | null>(null);

	onMount(() => {
		void (async () => {
			await telemetryState.init();
			enabled = telemetryState.enabled;
			host = telemetryState.host;
			publicKey = telemetryState.publicKey;
			captureMode = telemetryState.captureMode;
			loaded = true;
			void refreshDeliveryStatus();
		})();
		// FR-010: poll delivery health only while this section is mounted —
		// no global polling loop.
		const id = setInterval(() => void refreshDeliveryStatus(), 5000);
		return () => clearInterval(id);
	});

	async function refreshDeliveryStatus(): Promise<void> {
		try {
			const res = await serverClient.http('/api/telemetry/status');
			if (res.ok) deliveryStatus = (await res.json()) as TelemetryStatus;
		} catch {
			// Server unreachable — keep the last known status; the next tick retries.
		}
	}

	function fmtTime(iso: string): string {
		const t = Date.parse(iso);
		return Number.isFinite(t) ? new Date(t).toLocaleString() : iso;
	}

	// Plain-language probe outcomes per FR-004; the contract's 409 bodies map 1:1.
	function failureMessage(b: { error?: string; detail?: string }, httpStatus: number): string {
		switch (b.error) {
			case 'destination not reachable':
				return 'Could not reach the Langfuse host. Check the address and that Langfuse is running, then try again. Your previous settings were kept.';
			case 'credentials rejected':
				return 'Langfuse rejected the credentials. Check the public key here and the server’s MAYON_LANGFUSE_SECRET_KEY. Your previous settings were kept.';
			case 'server secret missing':
				return 'The server is missing MAYON_LANGFUSE_SECRET_KEY — set it in compose/.env (or your deployment’s environment) and restart the server, then try again.';
			default:
				return b.detail ?? b.error ?? `Request failed (${httpStatus})`;
		}
	}

	async function save(input: TelemetryConfigInput): Promise<boolean> {
		busy = true;
		error = null;
		try {
			const res = await serverClient.http('/api/telemetry/config', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			});
			const body: unknown = await res.json().catch(() => null);
			if (!res.ok) {
				const b = (body ?? {}) as { error?: string; detail?: string };
				error = failureMessage(b, res.status);
				return false;
			}
			const config = (body as { config?: TelemetryConfig } | null)?.config;
			if (config) telemetryState.applyConfig(config);
			void refreshDeliveryStatus();
			return true;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			return false;
		} finally {
			busy = false;
		}
	}

	function input(overrides: Partial<TelemetryConfigInput>): TelemetryConfigInput {
		return { enabled, host: host.trim(), publicKey: publicKey.trim(), captureMode, ...overrides };
	}

	async function toggle() {
		const next = !enabled;
		if (await save(input({ enabled: next }))) enabled = next;
	}

	async function apply() {
		await save(input({}));
	}

	async function changeMode() {
		// A mode change is an immediate config PUT: the next record already
		// follows the new mode — no restart, no reload.
		await save(input({}));
	}
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Telemetry</h2>
	</div>

	<p class="text-xs text-muted-foreground">
		Off by default. When on, each LLM interaction (chat turns, titles, quizzes, labs) is recorded
		and sent in the background from this deployment's server to your own Langfuse instance — nowhere
		else. The Langfuse secret key stays in the server's
		<code class="font-mono">MAYON_LANGFUSE_SECRET_KEY</code> environment variable and is never stored
		here. API keys of your AI providers are never included.
	</p>

	{#if deliveryStatus && !deliveryStatus.secretPresent}
		<p class="text-xs text-destructive" role="alert">
			The server environment does not have
			<code class="font-mono">MAYON_LANGFUSE_SECRET_KEY</code> set. Add it to
			<code class="font-mono">compose/.env</code> (or your deployment’s environment) and restart the server
			— records will queue but never deliver until then.
		</p>
	{/if}

	{#if loaded}
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm">Send LLM traces to Langfuse</p>
				<p class="text-xs text-muted-foreground">
					{#if enabled}
						On — records are delivered to {host || 'the configured host'}.
					{:else}
						Off — nothing is collected or transmitted.
					{/if}
				</p>
			</div>
			<Button
				variant={enabled ? 'outline' : 'ghost'}
				size="sm"
				aria-pressed={enabled}
				disabled={busy}
				onclick={toggle}
			>
				{enabled ? 'On' : 'Off'}
			</Button>
		</div>

		<div class="space-y-1">
			<label class="text-sm" for="telemetry-host">Langfuse host</label>
			<input
				id="telemetry-host"
				class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				type="url"
				placeholder="https://langfuse.example.com"
				bind:value={host}
			/>
		</div>

		<div class="space-y-1">
			<label class="text-sm" for="telemetry-public-key">Langfuse public key</label>
			<input
				id="telemetry-public-key"
				class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				type="text"
				placeholder="pk-lf-…"
				bind:value={publicKey}
				autocomplete="off"
			/>
			<p class="text-xs text-muted-foreground">
				The project's public key from your Langfuse project settings. It is non-secret; the secret
				key belongs in the server environment.
			</p>
		</div>

		<div class="space-y-1">
			<label class="text-sm" for="telemetry-capture-mode">Capture mode</label>
			<select
				id="telemetry-capture-mode"
				class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				bind:value={captureMode}
				onchange={changeMode}
			>
				{#each MODES as m (m.id)}
					<option value={m.id}>{m.label}</option>
				{/each}
			</select>
			<div class="space-y-2 pt-1">
				{#each MODES as m (m.id)}
					<div
						class="rounded-md border p-2 {m.id === captureMode ? 'border-ring' : 'border-input'}"
					>
						<p class="text-xs font-medium" class:text-muted-foreground={m.id !== captureMode}>
							{m.label}{m.id === captureMode ? ' — selected' : ''}
						</p>
						<p class="text-xs text-muted-foreground">
							<span class="font-medium">Leaves Mayon:</span>
							{m.leaves}
						</p>
						<p class="text-xs text-muted-foreground">
							<span class="font-medium">Stays local:</span>
							{m.stays}
						</p>
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				Changing the mode takes effect immediately for the next record — no restart needed. Content
				excluded by the mode is removed before anything is sent, not just hidden in Langfuse.
			</p>
		</div>

		{#if enabled && deliveryStatus}
			<div class="space-y-1 rounded-md border p-2">
				<p class="text-xs font-medium">Delivery health</p>
				{#if deliveryStatus.lastError}
					<p class="text-xs text-destructive">
						Delivery failing — {deliveryStatus.lastError.summary} (since
						{fmtTime(deliveryStatus.lastError.at)}).
						{deliveryStatus.queueDepth > 0
							? `${deliveryStatus.queueDepth} ${deliveryStatus.queueDepth === 1 ? 'record' : 'records'} waiting.`
							: ''}
					</p>
				{:else if deliveryStatus.lastDeliveredAt}
					<p class="text-xs text-muted-foreground">
						Last delivered {fmtTime(deliveryStatus.lastDeliveredAt)}.
						{deliveryStatus.queueDepth > 0 ? `${deliveryStatus.queueDepth} queued.` : ''}
					</p>
				{:else if deliveryStatus.queueDepth > 0}
					<p class="text-xs text-muted-foreground">
						{deliveryStatus.queueDepth}
						{deliveryStatus.queueDepth === 1 ? 'record' : 'records'} queued, not yet delivered.
					</p>
				{:else}
					<p class="text-xs text-muted-foreground">No records delivered yet.</p>
				{/if}
			</div>
		{/if}

		<div class="flex gap-2">
			<Button variant="outline" size="sm" disabled={busy} onclick={apply}>Apply</Button>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{/if}

	{#if error}
		<p class="text-xs text-destructive" role="alert">{error}</p>
	{/if}
</section>
