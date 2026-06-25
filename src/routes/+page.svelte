<script lang="ts">
	// Home — entry point. Real content lands in later phases.
</script>

<svelte:head>
	<title>Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
	<div class="space-y-2">
		<h1 class="text-4xl font-bold tracking-tight">Mayon</h1>
		<p class="text-lg text-muted-foreground">
			A local-first learning app built around a branchable chat graph.
		</p>
	</div>
	<div class="rounded-lg border border-border bg-card p-6 text-card-foreground">
		<p class="text-sm text-muted-foreground">
			P0 foundation is live. The data layer boots in both the browser (SQLite-WASM + OPFS) and the
			desktop shell (native SQLite via Tauri). Use the sidebar to explore the route placeholders.
		</p>
	</div>
</div>
