<script lang="ts">
	import { page } from '$app/state';
	import {
		FlaskConical,
		Home,
		ListChecks,
		MessageSquare,
		Network,
		Search,
		Settings
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import DbStatus from './DbStatus.svelte';
	import ServerStatus from './ServerStatus.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import { runtimeLabel } from '$lib/utils/runtime';

	type NavItem = { href: string; label: string; icon: Component };

	const nav: NavItem[] = [
		{ href: '/', label: 'Home', icon: Home },
		{ href: '/chat', label: 'Chat', icon: MessageSquare },
		{ href: '/lab', label: 'Labs', icon: FlaskConical },
		{ href: '/quiz', label: 'Quizzes', icon: ListChecks },
		{ href: '/tree', label: 'Tree', icon: Network },
		{ href: '/search', label: 'Search', icon: Search },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];

	let { collapsed = $bindable(false) }: { collapsed?: boolean } = $props();

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<aside
	class="flex h-full flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out"
	class:w-14={collapsed}
	class:w-60={!collapsed}
>
	<div
		class="flex h-14 items-center border-b border-sidebar-border transition-all duration-200 ease-out"
		class:px-4={!collapsed}
		class:px-3={collapsed}
		class:gap-2={!collapsed}
		class:gap-0={collapsed}
	>
		<div
			class="relative z-10 grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold"
		>
			M
		</div>
		<span
			class="overflow-hidden whitespace-nowrap font-semibold tracking-tight transition-all duration-200 ease-out"
			class:max-w-0={collapsed}
			class:opacity-0={collapsed}
			class:-translate-x-2={collapsed}
			class:max-w-[10rem]={!collapsed}
			class:opacity-100={!collapsed}
			class:translate-x-0={!collapsed}
		>
			Mayon
		</span>
	</div>

	<nav class="flex flex-1 flex-col gap-1 p-2">
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ease-out"
				class:gap-3={!collapsed}
				class:gap-0={collapsed}
				class:bg-sidebar-accent={isActive(item.href)}
				class:text-sidebar-accent-foreground={isActive(item.href)}
				class:text-muted-foreground={!isActive(item.href)}
				class:hover:bg-sidebar-accent={true}
				class:tip={collapsed}
				data-tip={item.label}
			>
				<item.icon class="relative z-10 size-4 shrink-0" />
				<span
					class="overflow-hidden whitespace-nowrap transition-all duration-200 ease-out"
					class:max-w-0={collapsed}
					class:opacity-0={collapsed}
					class:-translate-x-3={collapsed}
					class:max-w-[12rem]={!collapsed}
					class:opacity-100={!collapsed}
					class:translate-x-0={!collapsed}
				>
					{item.label}
				</span>
			</a>
		{/each}
	</nav>

	<div class="flex flex-col gap-1 border-t border-sidebar-border p-2">
		<ThemeToggle {collapsed} />
		<span
			class="overflow-hidden whitespace-nowrap px-2 text-xs text-muted-foreground transition-all duration-200 ease-out"
			class:max-w-0={collapsed}
			class:opacity-0={collapsed}
			class:max-w-[12rem]={!collapsed}
			class:opacity-100={!collapsed}
		>
			{runtimeLabel(dbStatus.runtime)}
		</span>
		<DbStatus {collapsed} />
		<ServerStatus {collapsed} />
	</div>
</aside>
