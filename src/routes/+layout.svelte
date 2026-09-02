<script lang="ts">
	import '../app.css';
	import '$lib/perf/probe';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { RefreshCw, Lock, ShieldCheck } from '@lucide/svelte';
	import { migrateLegacyKeys } from '$lib/ai/keystore/migrate';
	import { authState, dismissSetup, isSetupDismissed, refreshAuth } from '$lib/auth/state.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import BootGate from '$lib/components/BootGate.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { bootstrapDb } from '$lib/db/driver/client';
	import { repos } from '$lib/db';
	import { runSelfCheck } from '$lib/db/self-check';
	import { bindThemePersistence, themeState, type Theme } from '$lib/stores/theme.svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';

	let { children } = $props();

	let connecting = $derived(dbStatus.status === 'initializing');
	let unreachable = $derived(
		dbStatus.status === 'error' && dbStatus.reason === 'server-unreachable'
	);

	let setupDismissed = $state(isSetupDismissed());
	let authChecking = $state(false);

	const onLoginRoute = $derived(page.url.pathname === '/login');
	const lockedOut = $derived(
		authState.loaded && authState.mode === 'locked' && !authState.authenticated
	);
	const setupOffered = $derived(
		authState.loaded && authState.mode === 'open' && authState.setupRequired && !setupDismissed
	);

	let bootStarted = false;

	function startBoot() {
		if (bootStarted) return;
		bootStarted = true;
		void bootstrapDb()
			.then(async () => {
				await repos.settings.seedDefaults();
				await migrateLegacyKeys().catch(() => {
					/* non-fatal: retries next boot */
				});
				const stored = await repos.settings.get<Theme>('theme');
				if (stored) themeState.hydrate(stored);
				bindThemePersistence((t) => repos.settings.set('theme', t));
				if (import.meta.env.DEV) void runSelfCheck();
				if (import.meta.env.DEV) import('$lib/perf/longtask-warn');
			})
			.catch(() => {
				// Error already surfaced via the dbStatus store -> BootGate or DbStatus badge.
			});
	}

	async function retryAuth() {
		authChecking = true;
		try {
			await refreshAuth();
		} catch {
			// AuthState already fail-closed; the locked card stays with Retry available.
		} finally {
			authChecking = false;
		}
	}

	refreshAuth().catch(() => {
		// Failure is folded into authState (fail-closed to locked): the locked card
		// below takes over instead of falling through to a data boot.
	});

	$effect(() => {
		if (authState.loaded && !lockedOut && !setupOffered) startBoot();
	});

	function skipSetup() {
		dismissSetup();
		setupDismissed = true;
	}
</script>

{#if lockedOut && !onLoginRoute}
	<div class="fixed inset-0 grid place-items-center bg-background">
		<div class="flex max-w-md flex-col items-center gap-4 p-8 text-center">
			<Lock class="size-8 text-muted-foreground" />
			<h1 class="text-lg font-semibold">Mayon is locked.</h1>
			<p class="text-sm text-muted-foreground">
				Sign in with your password and authenticator code to continue.
			</p>
			<div class="mt-2 flex gap-2">
				<Button variant="outline" onclick={() => goto('/login')}>Go to login</Button>
				<Button variant="ghost" disabled={authChecking} onclick={retryAuth}>
					<RefreshCw class="size-4" />
					Retry
				</Button>
			</div>
		</div>
	</div>
{:else if setupOffered && !onLoginRoute}
	<div class="fixed inset-0 grid place-items-center bg-background">
		<div class="flex max-w-md flex-col items-center gap-4 p-8 text-center">
			<ShieldCheck class="size-8 text-muted-foreground" />
			<h1 class="text-lg font-semibold">Set up security?</h1>
			<p class="text-sm text-muted-foreground">
				Protect this app with a password and an authenticator code. You can also skip — the app
				stays open, and you can enable security later from Settings › Security.
			</p>
			<div class="mt-2 flex gap-2">
				<Button onclick={() => goto('/login?mode=setup')}>Set up security now</Button>
				<Button variant="ghost" onclick={skipSetup}>Skip</Button>
			</div>
		</div>
	</div>
{:else if lockedOut || setupOffered}
	<!-- On /login itself: render the auth route; no data boot while gated out. -->
	{@render children()}
{:else if connecting}
	<BootGate variant="connecting" />
{:else if unreachable}
	<BootGate variant="unreachable" />
{:else}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}
