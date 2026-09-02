<script lang="ts">
	import { goto } from '$app/navigation';
	import { AlertTriangle } from '@lucide/svelte';
	import { authState, logout } from '$lib/auth/state.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import InvitesPanel from '$lib/components/settings/InvitesPanel.svelte';
	import SessionsPanel from '$lib/components/settings/SessionsPanel.svelte';
	import ActivityPanel from '$lib/components/settings/ActivityPanel.svelte';

	type Tab = 'invites' | 'sessions' | 'activity';

	const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
		{ id: 'invites', label: 'Invites' },
		{ id: 'sessions', label: 'Sessions' },
		{ id: 'activity', label: 'Activity' }
	];

	let tab = $state<Tab>('invites');
	let signingOut = $state(false);

	const isOwner = $derived(authState.identity?.role === 'owner');

	async function signOut() {
		signingOut = true;
		try {
			await logout();
			await goto('/login');
		} finally {
			signingOut = false;
		}
	}
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Security</h2>
		{#if authState.loaded}
			<Badge variant={authState.mode === 'locked' ? 'default' : 'secondary'}>
				{authState.mode === 'locked' ? 'Locked' : 'Open'}
			</Badge>
		{/if}
	</div>

	{#if authState.loaded && authState.mode === 'open'}
		<div
			class="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
		>
			<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
			<p class="text-xs text-destructive">
				Security is off — anyone with the URL can use this deployment's data and AI providers.
			</p>
		</div>
	{/if}

	<p class="text-xs text-muted-foreground">
		While open, the app runs without a login. Enabling security requires a password and an
		authenticator app, and every server capability then stays behind a login until the end of each
		day.
	</p>

	{#if authState.mode === 'open'}
		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => goto('/login?mode=setup')}>
				Enable security
			</Button>
		</div>
	{:else if authState.authenticated}
		<div class="flex items-center gap-3">
			{#if authState.identity}
				<span class="text-xs text-muted-foreground">
					Signed in as {authState.identity.label}
				</span>
			{/if}
			<Button variant="outline" size="sm" disabled={signingOut} onclick={signOut}>Log out</Button>
		</div>

		{#if isOwner}
			<div class="flex gap-1 border-b border-border" role="tablist">
				{#each TABS as entry (entry.id)}
					<button
						type="button"
						role="tab"
						aria-selected={tab === entry.id}
						class="-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors {tab ===
						entry.id
							? 'border-primary text-foreground'
							: 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => (tab = entry.id)}
					>
						{entry.label}
					</button>
				{/each}
			</div>
			{#if tab === 'invites'}
				<InvitesPanel />
			{:else if tab === 'sessions'}
				<SessionsPanel />
			{:else}
				<ActivityPanel />
			{/if}
		{/if}
	{/if}
</section>
