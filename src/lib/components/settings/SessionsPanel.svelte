<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Loader2 } from '@lucide/svelte';
	import type { SessionDTO } from '@mayon/shared';
	import {
		AuthApiError,
		listSessions,
		revokeAllSessions,
		revokeSessionById
	} from '$lib/auth/client';
	import { refreshAuth } from '$lib/auth/state.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let sessions = $state<SessionDTO[]>([]);
	let loaded = $state(false);
	let listError = $state<string | null>(null);
	let confirmingId = $state<string | null>(null);
	let revokingId = $state<string | null>(null);
	let confirmingAll = $state(false);
	let revokingAll = $state(false);

	function describe(err: unknown): string {
		if (err instanceof AuthApiError) {
			if (err.status === 403) return 'Only the owner can manage all sessions.';
			if (err.status === 401) return 'Session expired — reload the page to sign in again.';
		}
		return err instanceof Error ? err.message : String(err);
	}

	async function refresh() {
		try {
			sessions = (await listSessions()).sessions;
			loaded = true;
		} catch (err) {
			listError = describe(err);
		}
	}

	onMount(() => {
		void refresh();
	});

	async function handleRevoke(id: string) {
		revokingId = id;
		try {
			await revokeSessionById(id);
			confirmingId = null;
			await refresh();
		} catch (err) {
			listError = describe(err);
		} finally {
			revokingId = null;
		}
	}

	async function handleRevokeAll() {
		revokingAll = true;
		try {
			await revokeAllSessions();
			await refreshAuth();
			await goto('/login');
		} catch (err) {
			listError = describe(err);
			revokingAll = false;
		}
	}

	const fmt = (ts: number) => new Date(ts).toLocaleString();
</script>

<div class="space-y-3">
	{#if listError}
		<p class="text-xs text-destructive" role="alert">{listError}</p>
	{/if}

	{#if loaded && sessions.length === 0}
		<p class="text-xs text-muted-foreground">No active sessions.</p>
	{:else if sessions.length > 0}
		<ul class="divide-y divide-border rounded-md border border-border">
			{#each sessions as session (session.id)}
				<li class="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
					<span class="font-medium">{session.identityLabel}</span>
					{#if session.current}
						<Badge variant="default">This device</Badge>
					{/if}
					{#if session.label}
						<span class="text-muted-foreground">{session.label}</span>
					{/if}
					<span class="text-muted-foreground">
						Created {fmt(session.createdAt)} · Expires {fmt(session.expiresAt)}
					</span>
					<span class="ml-auto flex items-center gap-2">
						{#if confirmingId === session.id}
							<Button
								variant="destructive"
								size="sm"
								disabled={revokingId === session.id}
								onclick={() => handleRevoke(session.id)}
							>
								Confirm revoke
							</Button>
							<Button variant="ghost" size="sm" onclick={() => (confirmingId = null)}>
								Cancel
							</Button>
						{:else}
							<Button variant="outline" size="sm" onclick={() => (confirmingId = session.id)}>
								Revoke
							</Button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex items-center gap-2">
		{#if confirmingAll}
			<p class="text-xs text-destructive">Sign out every device, including this one?</p>
			<Button variant="destructive" size="sm" disabled={revokingAll} onclick={handleRevokeAll}>
				{#if revokingAll}<Loader2 class="size-4 animate-spin" />{/if}
				Confirm revoke all
			</Button>
			<Button variant="ghost" size="sm" onclick={() => (confirmingAll = false)}>Cancel</Button>
		{:else}
			<Button variant="outline" size="sm" onclick={() => (confirmingAll = true)}>
				Revoke all sessions
			</Button>
		{/if}
	</div>
</div>
