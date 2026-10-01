<script lang="ts">
	import { onMount } from 'svelte';
	import { PanelLeft, PanelLeftClose } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import Sidebar from './Sidebar.svelte';
	import Toaster from './Toaster.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet/index.js';
	import { mediaQuery } from '$lib/utils/media.svelte.js';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	let collapsed = $state(localStorage.getItem('mayon:ui:sidebar') === '1');
	const lg = mediaQuery('(min-width: 1024px)');
	let drawerOpen = $state(false);

	$effect(() => {
		localStorage.setItem('mayon:ui:sidebar', collapsed ? '1' : '0');
	});

	onMount(() => {
		function onKeydown(e: KeyboardEvent) {
			const tag = (e.target as HTMLElement)?.tagName;
			const editable = (e.target as HTMLElement)?.isContentEditable;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
			if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
				e.preventDefault();
				goto('/search');
			}
		}
		window.addEventListener('keydown', onKeydown);

		return () => {
			window.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<div class="flex h-dvh w-full overflow-hidden bg-background text-foreground">
	{#if lg.matches}
		<Sidebar bind:collapsed />
	{:else}
		<Sheet open={drawerOpen} onOpenChange={(v) => (drawerOpen = v)}>
			<SheetContent side="left" class="w-60 p-0">
				<SheetHeader class="sr-only">
					<SheetTitle>Navigation</SheetTitle>
				</SheetHeader>
				<Sidebar onNavigate={() => (drawerOpen = false)} />
			</SheetContent>
		</Sheet>
	{/if}

	<div class="relative flex min-w-0 flex-1 flex-col">
		<Button
			variant="ghost"
			size="icon"
			class="absolute top-2 left-2 z-30 tip size-10 rounded-lg border border-border bg-card shadow-(--shadow-card)"
			data-tip="Toggle sidebar"
			aria-label="Toggle sidebar"
			onclick={() => {
				if (lg.matches) {
					collapsed = !collapsed;
				} else {
					drawerOpen = !drawerOpen;
				}
			}}
		>
			{#if lg.matches && !collapsed}
				<PanelLeftClose class="size-4" />
			{:else}
				<PanelLeft class="size-4" />
			{/if}
		</Button>

		<main
			class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [@media(any-pointer:coarse)]:pb-[env(safe-area-inset-bottom)]"
		>
			{@render children()}
		</main>

		<Toaster />
	</div>
</div>
