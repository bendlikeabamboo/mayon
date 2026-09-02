<script lang="ts">
	import { onMount } from 'svelte';
	import type { AttemptDTO } from '@mayon/shared';
	import { AuthApiError, listAttempts } from '$lib/auth/client';
	import { Badge } from '$lib/components/ui/badge/index.js';

	let attempts = $state<AttemptDTO[]>([]);
	let loaded = $state(false);
	let listError = $state<string | null>(null);

	function describe(err: unknown): string {
		if (err instanceof AuthApiError) {
			if (err.status === 403) return 'Only the owner can view login activity.';
			if (err.status === 401) return 'Session expired — reload the page to sign in again.';
		}
		return err instanceof Error ? err.message : String(err);
	}

	async function refresh() {
		try {
			attempts = (await listAttempts()).attempts;
			loaded = true;
		} catch (err) {
			listError = describe(err);
		}
	}

	onMount(() => {
		void refresh();
	});

	function outcomeBadge(outcome: AttemptDTO['outcome']): {
		variant: 'default' | 'secondary' | 'destructive' | 'outline';
		text: string;
	} {
		if (outcome === 'success') return { variant: 'default', text: 'Success' };
		if (outcome === 'bad_password') return { variant: 'destructive', text: 'Wrong password' };
		if (outcome === 'bad_code') return { variant: 'destructive', text: 'Wrong code' };
		return { variant: 'outline', text: 'Unknown name' };
	}

	const fmt = (ts: number) => new Date(ts).toLocaleString();
</script>

<div class="space-y-3">
	{#if listError}
		<p class="text-xs text-destructive" role="alert">{listError}</p>
	{/if}

	{#if loaded && attempts.length === 0}
		<p class="text-xs text-muted-foreground">No login activity recorded yet.</p>
	{:else if attempts.length > 0}
		<ul class="divide-y divide-border rounded-md border border-border">
			{#each attempts as attempt (attempt.at)}
				{@const badge = outcomeBadge(attempt.outcome)}
				<li class="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
					<span>{fmt(attempt.at)}</span>
					<span class="font-medium">{attempt.identityLabel ?? '(unknown)'}</span>
					<Badge variant={badge.variant}>{badge.text}</Badge>
					<span class="ml-auto text-muted-foreground">from {attempt.source}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
