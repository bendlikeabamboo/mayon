<script lang="ts">
	import { PanelLeft } from '@lucide/svelte';
	import Sidebar from './Sidebar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import DbStatus from './DbStatus.svelte';
	import Toaster from './Toaster.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
	let collapsed = $state(false);
</script>

<div class="flex h-screen w-screen overflow-hidden bg-background text-foreground">
	<Sidebar bind:collapsed />

	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3"
		>
			<div class="flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					title="Toggle sidebar"
					aria-label="Toggle sidebar"
					onclick={() => (collapsed = !collapsed)}
				>
					<PanelLeft />
				</Button>
			</div>
			<div class="flex items-center gap-2">
				<DbStatus />
				<ThemeToggle />
			</div>
		</header>

		<main class="min-h-0 flex-1 overflow-auto">
			{@render children()}
		</main>

		<Toaster />
	</div>
</div>
