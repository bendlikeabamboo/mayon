<script lang="ts">
	import { Download, Loader2, RefreshCw, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { updater } from '$lib/updater.svelte.js';
	import { isTauri } from '$lib/db';

	const percent = $derived(Math.round(updater.progress * 100));
</script>

{#if isTauri()}
	{#if updater.status === 'available'}
		<div
			class="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
		>
			<span>Update available (v{updater.version})</span>
			<Button variant="outline" size="sm" onclick={() => void updater.downloadAndInstall()}>
				<Download class="size-3.5" />Download &amp; install
			</Button>
		</div>
	{:else if updater.status === 'downloading'}
		<div
			class="flex flex-col gap-1 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
		>
			<span class="inline-flex items-center gap-1.5">
				<Loader2 class="size-3.5 animate-spin" />Downloading update… {percent}%
			</span>
			<div class="h-1 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full bg-primary transition-[width]" style="width: {percent}%"></div>
			</div>
		</div>
	{:else if updater.status === 'installed'}
		<div
			class="flex items-center justify-between gap-2 border-b border-border bg-emerald-500/10 px-4 py-1.5 text-xs text-emerald-700 dark:text-emerald-400"
		>
			<span>Update ready</span>
			<Button variant="outline" size="sm" onclick={() => void updater.relaunch()}>
				<RotateCcw class="size-3.5" />Restart
			</Button>
		</div>
	{:else if updater.status === 'error'}
		<div
			class="flex items-center justify-between gap-2 border-b border-border bg-red-500/10 px-4 py-1.5 text-xs text-red-700 dark:text-red-400"
		>
			<span class="truncate">Update check failed: {updater.error}</span>
			<Button variant="outline" size="sm" onclick={() => void updater.check()}>
				<RefreshCw class="size-3.5" />Retry
			</Button>
		</div>
	{/if}
{/if}
