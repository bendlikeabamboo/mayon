<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover/index.js';
	import { serverStatus } from '$lib/services/status.svelte.js';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import DbStatus from './DbStatus.svelte';
	import ServerStatus from './ServerStatus.svelte';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	/**
	 * Aggregate indicator precedence (design-tokens.md §5), first match wins:
	 *   1. RED    — hard db error, unless the error merely means "server off"
	 *               (reason 'server-unreachable', i.e. browser-only mode);
	 *               also an explicitly recorded server probe error.
	 *   2. GRAY   — unknown/degraded facts only: db still initializing at boot,
	 *               or server off/unreachable without further detail (the
	 *               popover explains the unknown; no alarming hue).
	 *   3. AMBER  — warning signal: dev self-check pending or failed.
	 *   4. GREEN  — everything nominal: db ready + server connected.
	 */
	type Aggregate = 'error' | 'unknown' | 'warn' | 'ok';

	const aggregate = $derived.by((): Aggregate => {
		if (dbStatus.status === 'error' && dbStatus.reason !== 'server-unreachable') return 'error';
		// An explicitly recorded probe error means the server was there and broke.
		if (serverStatus.error) return 'error';
		// Boot/unknown facts only — no alarming hue; the popover explains them.
		if (
			dbStatus.status === 'initializing' ||
			dbStatus.reason === 'server-unreachable' ||
			!serverStatus.connected
		)
			return 'unknown';
		if (dbStatus.selfCheck === 'pending' || dbStatus.selfCheck === 'fail') return 'warn';
		return 'ok';
	});

	const dotColor = $derived(
		cn(
			aggregate === 'ok' && 'bg-emerald-500',
			aggregate === 'warn' && 'bg-amber-500',
			aggregate === 'error' && 'bg-red-500',
			aggregate === 'unknown' && 'bg-muted-foreground/60'
		)
	);

	const label = $derived.by(() => {
		const serverPart = serverStatus.connected
			? serverStatus.version
				? `server v${serverStatus.version}`
				: 'server ok'
			: 'server off';
		const dbPart =
			dbStatus.status === 'initializing'
				? 'db booting'
				: dbStatus.status === 'ready'
					? 'db ready'
					: dbStatus.reason === 'server-unreachable'
						? 'db offline'
						: 'db error';
		return `${serverPart} · ${dbPart}`;
	});
</script>

<Popover>
	<PopoverTrigger
		class={cn(
			'flex w-full cursor-pointer items-center rounded-md py-1 pr-2 text-left text-xs font-medium text-muted-foreground transition-colors duration-200 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-ring outline-none focus-visible:ring-2',
			collapsed ? 'justify-center gap-0 pl-2' : 'gap-2 pl-2'
		)}
		title={label}
		aria-label="System status: {label}"
		data-status={aggregate}
	>
		<span class="relative z-10 grid size-4 shrink-0 place-items-center" aria-hidden="true">
			<span class={cn('size-2 rounded-full transition-colors duration-200', dotColor)}></span>
		</span>
		<span
			class="min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out"
			class:max-w-0={collapsed}
			class:opacity-0={collapsed}
			class:-translate-x-1.5={collapsed}
			class:max-w-60={!collapsed}
			class:opacity-100={!collapsed}
			class:translate-x-0={!collapsed}
		>
			{label}
		</span>
	</PopoverTrigger>
	<PopoverContent side="top" align="start" class="w-72">
		<div class="flex flex-col gap-2.5">
			<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				System status
			</p>
			<DbStatus />
			<div class="border-border h-px border-t"></div>
			<ServerStatus />
		</div>
	</PopoverContent>
</Popover>
