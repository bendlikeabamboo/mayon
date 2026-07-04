<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { isTauri } from '$lib/db';
	import { createBackup, restoreBackupFromBytes, restoreBackupFromPath } from '$lib/db/backup';
	import { chatStore } from '$lib/stores/chat.svelte';

	let busy = $state(false);
	let error = $state<string | null>(null);
	let status = $state<string | null>(null);

	let fileInputEl: HTMLInputElement | undefined = $state();

	async function handleBackup() {
		busy = true;
		error = null;
		status = null;
		try {
			await createBackup();
			status = isTauri() ? 'Backup saved.' : 'Backup downloaded.';
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
			if (isTauri()) {
				const { open } = await import('@tauri-apps/plugin-dialog');
				const p = await open({
					filters: [{ name: 'SQLite', extensions: ['sqlite'] }],
					multiple: false
				});
				if (p) await restoreBackupFromPath(p as string);
			} else {
				fileInputEl?.click();
			}
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

	<!-- UX4: Rebuild search index button -->
</section>
