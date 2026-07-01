<script lang="ts">
	import { onMount } from 'svelte';
	import {
		PanelLeft,
		FlaskConical,
		Home,
		ListChecks,
		MessageSquare,
		Network,
		Settings
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import Sidebar from './Sidebar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import DbStatus from './DbStatus.svelte';
	import Toaster from './Toaster.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet/index.js';
	import type { Component, Snippet } from 'svelte';

	type NavItem = { href: string; label: string; icon: Component };

	const nav: NavItem[] = [
		{ href: '/', label: 'Home', icon: Home },
		{ href: '/chat', label: 'Chat', icon: MessageSquare },
		{ href: '/lab', label: 'Labs', icon: FlaskConical },
		{ href: '/quiz', label: 'Quizzes', icon: ListChecks },
		{ href: '/tree', label: 'Tree', icon: Network },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];

	let { children }: { children: Snippet } = $props();

	let collapsed = $state(localStorage.getItem('mayon:ui:sidebar') === '1');
	let lg = $state(false);
	let drawerOpen = $state(false);

	$effect(() => {
		localStorage.setItem('mayon:ui:sidebar', collapsed ? '1' : '0');
	});

	onMount(() => {
		const mq = window.matchMedia('(min-width: 1024px)');
		lg = mq.matches;
		function onMatchChange(e: MediaQueryListEvent) {
			lg = e.matches;
		}
		mq.addEventListener('change', onMatchChange);
		return () => mq.removeEventListener('change', onMatchChange);
	});

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<div class="flex h-screen w-screen overflow-hidden bg-background text-foreground">
	{#if lg}
		<Sidebar bind:collapsed />
	{:else}
		<Sheet open={drawerOpen} onOpenChange={(v) => (drawerOpen = v)}>
			<SheetContent side="left" class="w-60 p-0">
				<SheetHeader class="sr-only">
					<SheetTitle>Navigation</SheetTitle>
				</SheetHeader>
				<aside class="flex h-full flex-col bg-sidebar text-sidebar-foreground">
					<div class="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
						<div
							class="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold"
						>
							M
						</div>
						<span class="font-semibold tracking-tight">Mayon</span>
					</div>
					<nav class="flex flex-1 flex-col gap-1 p-2">
						{#each nav as item (item.href)}
							<a
								href={item.href}
								class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
								class:bg-sidebar-accent={isActive(item.href)}
								class:text-sidebar-accent-foreground={isActive(item.href)}
								class:text-muted-foreground={!isActive(item.href)}
								class:hover:bg-sidebar-accent={true}
								onclick={() => (drawerOpen = false)}
							>
								<item.icon class="size-4 shrink-0" />
								{item.label}
							</a>
						{/each}
					</nav>
				</aside>
			</SheetContent>
		</Sheet>
	{/if}

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
					onclick={() => {
						if (lg) {
							collapsed = !collapsed;
						} else {
							drawerOpen = !drawerOpen;
						}
					}}
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
