<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { sidecarStatus } from '$lib/sidecar/status.svelte';
	import { sandboxQuery, sandboxExec, sandboxTables } from '$lib/sidecar/sandbox-db';
	import { onMount } from 'svelte';

	let sql = $state("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
	let busy = $state(false);
	let error = $state<string | null>(null);
	let resultRows = $state<unknown[][] | null>(null);
	let resultColumns = $state<string[]>([]);
	let affectedRows = $state<number | null>(null);
	let tables = $state<string[]>([]);

	async function loadTables() {
		try {
			tables = await sandboxTables();
		} catch {
			tables = [];
		}
	}

	async function run() {
		busy = true;
		error = null;
		resultRows = null;
		resultColumns = [];
		affectedRows = null;
		try {
			const trimmed = sql.trim().toUpperCase();
			if (
				trimmed.startsWith('SELECT') ||
				trimmed.startsWith('WITH') ||
				trimmed.startsWith('PRAGMA')
			) {
				const res = await sandboxQuery(trimmed);
				resultColumns = res.columns;
				resultRows = res.rows;
			} else {
				const res = await sandboxExec(trimmed);
				affectedRows = res.changes;
				await loadTables();
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	let copied = $state(false);

	async function copyPath() {
		if (!sidecarStatus.sandboxDbPath) return;
		try {
			await navigator.clipboard.writeText(sidecarStatus.sandboxDbPath);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// noop
		}
	}

	onMount(loadTables);
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sandbox DB</h2>
	</div>

	<p class="text-xs text-muted-foreground">
		Isolated SQLite instance for MCP tools and sandboxed compute. This DB never holds app data or
		secrets.
	</p>

	<div
		class="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-mono"
	>
		<span class="text-muted-foreground">Path:</span>
		<span>{sidecarStatus.sandboxDbPath}</span>
		<button
			class="ml-auto text-muted-foreground hover:text-foreground"
			onclick={copyPath}
			type="button"
			title="Copy path"
		>
			{#if copied}
				Copied
			{:else}
				Copy
			{/if}
		</button>
	</div>

	<p class="text-xs text-muted-foreground">
		Paste this path into your custom stdio MCP server's args.
	</p>

	{#if tables.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each tables as t (t)}
				<span class="rounded border border-border bg-muted px-2 py-0.5 text-xs font-mono">
					{t}
				</span>
			{/each}
		</div>
	{:else}
		<p class="text-xs text-muted-foreground italic">No tables yet.</p>
	{/if}

	<textarea
		class="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
		rows="4"
		bind:value={sql}
		placeholder="SQL statement..."></textarea>

	<div class="flex items-center gap-2">
		<Button variant="outline" size="sm" {busy} onclick={run}>Run</Button>
	</div>

	{#if resultRows !== null && resultColumns.length > 0}
		<div class="overflow-x-auto rounded-md border border-border">
			<table class="w-full text-xs">
				<thead>
					<tr class="border-b border-border bg-muted/50">
						{#each resultColumns as col (col)}
							<th class="px-3 py-1.5 text-left font-medium">{col}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each resultRows as row, ri (ri)}
						<tr class="border-b border-border last:border-0">
							{#each row as cell, ci (ci)}
								<td class="px-3 py-1.5">{String(cell ?? 'NULL')}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if affectedRows !== null}
		<p class="text-xs text-muted-foreground">{affectedRows} row(s) affected.</p>
	{/if}

	{#if error}
		<p class="text-xs text-destructive" role="alert">{error}</p>
	{/if}
</section>
