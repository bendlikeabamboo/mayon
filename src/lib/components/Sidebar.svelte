<script lang="ts">
	import { page } from '$app/state';
	import { FlaskConical, Home, ListChecks, MessageSquare, Network, Settings } from '@lucide/svelte';
	import type { Component } from 'svelte';

	type NavItem = { href: string; label: string; icon: Component };

	const nav: NavItem[] = [
		{ href: '/', label: 'Home', icon: Home },
		{ href: '/chat', label: 'Chat', icon: MessageSquare },
		{ href: '/lab', label: 'Labs', icon: FlaskConical },
		{ href: '/quiz', label: 'Quizzes', icon: ListChecks },
		{ href: '/tree', label: 'Tree', icon: Network },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];

	let { collapsed = $bindable(false) }: { collapsed?: boolean } = $props();

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<aside
	class="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200"
	class:w-16={collapsed}
	class:w-60={!collapsed}
>
	<div class="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
		<div
			class="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold"
		>
			M
		</div>
		{#if !collapsed}<span class="font-semibold tracking-tight">Mayon</span>{/if}
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
				title={item.label}
			>
				<item.icon class="size-4 shrink-0" />
				{#if !collapsed}{item.label}{/if}
			</a>
		{/each}
	</nav>
</aside>
