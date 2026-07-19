<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { downloadDbBackup, restoreDbBackup } from '$lib/services/db-backup';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { serverStatus } from '$lib/services/status.svelte';
	import { downloadSandboxBackup, restoreSandboxBackup } from '$lib/services/sandbox-backup';
	import { dryRunImport, importFromSqlite } from '$lib/services/db-import';
	import type { ImportPreview } from '$lib/services/db-import';

	let busy = $state(false);
	let error = $state<string | null>(null);
	let status = $state<string | null>(null);

	let fileInputEl: HTMLInputElement | undefined = $state();
	let sandboxFileInputEl: HTMLInputElement | undefined = $state();

	let sandboxBusy = $state(false);
	let sandboxError = $state<string | null>(null);
	let sandboxStatus = $state<string | null>(null);

	let importBusy = $state(false);
	let importError = $state<string | null>(null);
	let importStatus = $state<string | null>(null);
	let importPreview: ImportPreview | null = $state(null);
	let importFileEl: HTMLInputElement | undefined = $state();
	let currentImportFile: File | null = $state(null);

	async function handleBackup() {
		busy = true;
		error = null;
		status = null;
		try {
			await downloadDbBackup();
			status = 'Backup downloaded.';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	function handleRestore() {
		fileInputEl?.click();
	}

	async function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			await restoreDbBackup(file);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			busy = false;
		}
		if (input) input.value = '';
	}

	const disabled = $derived(busy || chatStore.streaming);

	async function handleSandboxDownload() {
		sandboxBusy = true;
		sandboxError = null;
		sandboxStatus = null;
		try {
			await downloadSandboxBackup();
			sandboxStatus = 'Sandbox backup downloaded.';
		} catch (err) {
			sandboxError = err instanceof Error ? err.message : String(err);
		} finally {
			sandboxBusy = false;
		}
	}

	function handleSandboxRestoreClick() {
		sandboxFileInputEl?.click();
	}

	async function handleSandboxFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		sandboxBusy = true;
		sandboxError = null;
		sandboxStatus = null;
		try {
			await restoreSandboxBackup(file);
			sandboxStatus = 'Sandbox DB restored.';
		} catch (err) {
			sandboxError = err instanceof Error ? err.message : String(err);
		} finally {
			sandboxBusy = false;
		}
		if (input) input.value = '';
	}

	function handleImportClick() {
		importFileEl?.click();
	}

	async function handleImportFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importBusy = true;
		importError = null;
		importPreview = null;
		importStatus = null;
		currentImportFile = file;
		try {
			importPreview = await dryRunImport(file);
		} catch (err) {
			importError = err instanceof Error ? err.message : String(err);
		} finally {
			importBusy = false;
		}
		if (input) input.value = '';
	}

	function cancelImport() {
		importPreview = null;
		importError = null;
		currentImportFile = null;
	}

	async function confirmImport() {
		if (!currentImportFile) return;
		importBusy = true;
		importError = null;
		importStatus = null;
		try {
			const { summary } = await importFromSqlite(currentImportFile);
			const total = Object.values(summary).reduce((a, b) => a + b, 0);
			importStatus = `Imported ${total} rows.`;
			location.reload();
		} catch (err) {
			importError = err instanceof Error ? err.message : String(err);
		} finally {
			importBusy = false;
		}
	}

	const importDisabled = $derived(importBusy || chatStore.streaming);
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Data</h2>
	</div>

	<p class="text-xs text-muted-foreground">
		Backups are Postgres custom-format dumps (`.dump`) — data only, no API keys. Restoring first
		downloads a safety backup, then replaces all data and reloads.
	</p>

	<input
		bind:this={fileInputEl}
		type="file"
		accept=".dump,.backup"
		class="hidden"
		onchange={handleFileInput}
	/>

	<div class="flex gap-2">
		{#if serverStatus.has('pg')}
			<Button variant="outline" size="sm" {disabled} onclick={handleBackup}>Download backup</Button>
			<Button variant="outline" size="sm" {disabled} onclick={handleRestore}>
				Restore from backup
			</Button>
		{/if}
	</div>

	{#if status}
		<p class="text-xs text-muted-foreground" role="status">{status}</p>
	{/if}

	{#if error}
		<p class="text-xs text-destructive" role="alert">{error}</p>
	{/if}

	{#if serverStatus.has('pg')}
		<hr class="border-border" />

		<h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
			Import from SQLite backup
		</h3>

		<p class="text-xs text-muted-foreground">
			Load chats, labs, and quizzes from a legacy (pre-Postgres) SQLite backup. This
			<strong>replaces all current data</strong>; a safety backup downloads first. API keys are not
			included — re-enter provider keys after import.
		</p>

		<input
			bind:this={importFileEl}
			type="file"
			accept=".sqlite,.db"
			class="hidden"
			onchange={handleImportFileInput}
		/>

		<div class="flex gap-2">
			<Button variant="outline" size="sm" {importDisabled} onclick={handleImportClick}>
				Import from SQLite backup
			</Button>
		</div>

		{#if importPreview}
			<div class="rounded border border-border p-3 space-y-2 text-xs">
				<table class="w-full text-left">
					<thead>
						<tr>
							<th class="font-medium text-muted-foreground">Table</th>
							<th class="font-medium text-muted-foreground">Rows</th>
						</tr>
					</thead>
					<tbody>
						{#each Object.entries(importPreview.summary) as [table, count] (table)}
							<tr>
								<td>{table}</td>
								<td>{count}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if importPreview.warnings.length > 0}
					<div class="text-yellow-600">
						{#each importPreview.warnings as w (w)}
							<p>{w}</p>
						{/each}
					</div>
				{/if}
				<p class="text-destructive font-medium">This will replace all current data. Continue?</p>
				<div class="flex gap-2">
					<Button variant="destructive" size="sm" {importDisabled} onclick={confirmImport}>
						Confirm
					</Button>
					<Button variant="outline" size="sm" onclick={cancelImport}>Cancel</Button>
				</div>
			</div>
		{/if}

		{#if importStatus}
			<p class="text-xs text-muted-foreground" role="status">{importStatus}</p>
		{/if}

		{#if importError}
			<p class="text-xs text-destructive" role="alert">{importError}</p>
		{/if}
	{/if}

	{#if serverStatus.has('backup')}
		<hr class="border-border" />

		<h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sandbox DB</h3>

		<p class="text-xs text-muted-foreground">
			Back up the server sandbox DB (MCP-tool data). This is separate from your chats, labs, and
			quizzes above.
		</p>

		<input
			bind:this={sandboxFileInputEl}
			type="file"
			accept=".sqlite"
			class="hidden"
			onchange={handleSandboxFileInput}
		/>

		<div class="flex gap-2">
			<Button variant="outline" size="sm" disabled={sandboxBusy} onclick={handleSandboxDownload}>
				Download sandbox backup
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={sandboxBusy}
				onclick={handleSandboxRestoreClick}
			>
				Restore sandbox backup
			</Button>
		</div>

		{#if sandboxStatus}
			<p class="text-xs text-muted-foreground" role="status">{sandboxStatus}</p>
		{/if}

		{#if sandboxError}
			<p class="text-xs text-destructive" role="alert">{sandboxError}</p>
		{/if}
	{/if}
</section>
