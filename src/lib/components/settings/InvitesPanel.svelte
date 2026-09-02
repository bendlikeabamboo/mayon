<script lang="ts">
	import { onMount } from 'svelte';
	import { Loader2 } from '@lucide/svelte';
	import type { InviteDTO } from '@mayon/shared';
	import { AuthApiError, createInvite, listInvites, revokeInvite } from '$lib/auth/client';
	import type { InviteCreateResponse } from '@mayon/shared';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let invites = $state<InviteDTO[]>([]);
	let loaded = $state(false);
	let listError = $state<string | null>(null);
	let label = $state('');
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let issued: (InviteCreateResponse & { label: string }) | null = $state(null);
	let copied = $state(false);
	let confirmingId = $state<string | null>(null);
	let revokingId = $state<string | null>(null);

	function describe(err: unknown): string {
		if (err instanceof AuthApiError) {
			if (err.code === 'invalid label') return 'Use a name between 1 and 64 characters.';
			if (err.code === 'duplicate label') return 'That name is already in use.';
			if (err.status === 403) return 'Only the owner can manage invites.';
			if (err.status === 401) return 'Session expired — reload the page to sign in again.';
		}
		return err instanceof Error ? err.message : String(err);
	}

	async function refresh() {
		try {
			invites = (await listInvites()).invites;
			loaded = true;
		} catch (err) {
			listError = describe(err);
		}
	}

	onMount(() => {
		void refresh();
	});

	async function handleCreate(event: SubmitEvent) {
		event.preventDefault();
		const name = label.trim();
		if (name.length < 1 || name.length > 64) {
			createError = 'Use a name between 1 and 64 characters.';
			return;
		}
		creating = true;
		createError = null;
		try {
			const res = await createInvite(name);
			issued = { ...res, label: name };
			label = '';
			copied = false;
			await refresh();
		} catch (err) {
			createError = describe(err);
		} finally {
			creating = false;
		}
	}

	async function handleCopy() {
		if (!issued) return;
		try {
			await navigator.clipboard.writeText(issued.oneTimePassword);
			copied = true;
		} catch {
			// clipboard unavailable — the password stays selectable in the panel
		}
	}

	async function handleRevoke(id: string) {
		revokingId = id;
		try {
			await revokeInvite(id);
			confirmingId = null;
			await refresh();
		} catch (err) {
			listError = describe(err);
		} finally {
			revokingId = null;
		}
	}

	function statusBadge(status: InviteDTO['status']): {
		variant: 'secondary' | 'default' | 'outline';
		text: string;
	} {
		if (status === 'invited') return { variant: 'secondary', text: 'Invited' };
		if (status === 'active') return { variant: 'default', text: 'Active' };
		return { variant: 'outline', text: 'Revoked' };
	}

	const fmt = (ts: number) => new Date(ts).toLocaleString();
	const inputClass =
		'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
</script>

<div class="space-y-3">
	<form class="flex items-end gap-2" onsubmit={handleCreate}>
		<div class="min-w-0 flex-1 space-y-1">
			<label class="block text-xs font-medium text-muted-foreground" for="invite-label">
				Name
			</label>
			<input
				id="invite-label"
				bind:value={label}
				maxlength={64}
				placeholder="e.g. friend"
				autocomplete="off"
				class={inputClass}
			/>
		</div>
		<Button type="submit" size="sm" disabled={creating}>
			{#if creating}<Loader2 class="size-4 animate-spin" />{/if}
			Invite someone
		</Button>
	</form>

	{#if createError}
		<p class="text-xs text-destructive" role="alert">{createError}</p>
	{/if}

	{#if issued}
		<div class="space-y-2 rounded-md border border-border p-3">
			<p class="text-xs text-muted-foreground">
				One-time password for <span class="font-medium text-foreground">{issued.label}</span>:
			</p>
			<div class="flex items-center gap-2">
				<code
					class="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs select-all"
				>
					{issued.oneTimePassword}
				</code>
				<Button type="button" variant="outline" size="sm" onclick={handleCopy}>
					{copied ? 'Copied' : 'Copy'}
				</Button>
			</div>
			<p class="text-xs font-medium text-destructive" role="alert">
				This password is shown only once — share it with {issued.label} now; it cannot be retrieved later.
			</p>
			<Button type="button" variant="ghost" size="sm" onclick={() => (issued = null)}>Done</Button>
		</div>
	{/if}

	{#if listError}
		<p class="text-xs text-destructive" role="alert">{listError}</p>
	{/if}

	{#if loaded && invites.length === 0}
		<p class="text-xs text-muted-foreground">No invites yet.</p>
	{:else if invites.length > 0}
		<ul class="divide-y divide-border rounded-md border border-border">
			{#each invites as invite (invite.id)}
				{@const badge = statusBadge(invite.status)}
				<li class="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
					<span class="font-medium">{invite.label}</span>
					<Badge variant={badge.variant}>{badge.text}</Badge>
					<span class="text-muted-foreground">Created {fmt(invite.createdAt)}</span>
					<span class="ml-auto flex items-center gap-2">
						{#if confirmingId === invite.id}
							<Button
								variant="destructive"
								size="sm"
								disabled={revokingId === invite.id}
								onclick={() => handleRevoke(invite.id)}
							>
								Confirm revoke
							</Button>
							<Button variant="ghost" size="sm" onclick={() => (confirmingId = null)}>
								Cancel
							</Button>
						{:else if invite.status !== 'revoked'}
							<Button variant="outline" size="sm" onclick={() => (confirmingId = invite.id)}>
								Revoke
							</Button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
