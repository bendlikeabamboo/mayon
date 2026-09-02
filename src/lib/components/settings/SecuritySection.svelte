<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState, logout } from '$lib/auth/state.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let signingOut = $state(false);

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
		<div class="flex gap-2">
			<Button variant="outline" size="sm" disabled={signingOut} onclick={signOut}>Log out</Button>
		</div>
	{/if}
</section>
