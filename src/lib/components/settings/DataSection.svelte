<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { repos } from '$lib/db';
	import { createBackup, restoreBackupFromBytes } from '$lib/db/backup';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { serverStatus } from '$lib/server/status.svelte';
	import { downloadSandboxBackup, restoreSandboxBackup } from '$lib/server/sandbox-backup';

	let busy = $state(false);
	let error = $state<string | null>(null);
	let status = $state<string | null>(null);

	let fileInputEl: HTMLInputElement | undefined = $state();
	let sandboxFileInputEl: HTMLInputElement | undefined = $state();

	let sandboxBusy = $state(false);
	let sandboxError = $state<string | null>(null);
	let sandboxStatus = $state<string | null>(null);

	async function handleBackup() {
		busy = true;
		error = null;
		status = null;
		try {
			await createBackup();
			status = 'Backup downloaded.';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function handleRestore() {
		busy = true;
		error = null;
		status = null;
		try {
			fileInputEl?.click();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			busy = false;
		}
	}

	async function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			await restoreBackupFromBytes(bytes);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			busy = false;
		}
		if (input) input.value = '';
	}

	const disabled = $derived(busy || chatStore.streaming);

	async function handleRebuildIndex() {
		if (!confirm('Rebuild the search index from scratch?')) return;
		busy = true;
		error = null;
		status = null;
		try {
			await repos.search.rebuildIndex();
			status = 'Search index rebuilt.';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

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
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Data</h2>
	</div>

	<p class="text-xs text-muted-foreground">
		Download a full backup of your data, or restore from a previous backup file. Backups are
		data-only — they do not include API keys.
	</p>

	<input
		bind:this={fileInputEl}
		type="file"
		accept=".sqlite"
		class="hidden"
		onchange={handleFileInput}
	/>

	<div class="flex gap-2">
		<Button variant="outline" size="sm" {disabled} onclick={handleBackup}>Download backup</Button>
		<Button variant="outline" size="sm" {disabled} onclick={handleRestore}>
			Restore from backup
		</Button>
	</div>

	{#if status}
		<p class="text-xs text-muted-foreground" role="status">{status}</p>
	{/if}

	{#if error}
		<p class="text-xs text-destructive" role="alert">{error}</p>
	{/if}

	<hr class="border-border" />

	<Button variant="outline" size="sm" {disabled} onclick={handleRebuildIndex}>
		Rebuild search index
	</Button>

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
