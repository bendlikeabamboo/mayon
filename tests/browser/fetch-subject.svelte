<script lang="ts">
	import { onMount } from 'svelte';

	let status = $state<'loading' | 'ready' | 'failed'>('loading');
	let identity = $state<string | null>(null);
	let mode = $state<string | null>(null);

	onMount(async () => {
		try {
			const res = await fetch('/api/auth/session', { method: 'POST' });
			if (!res.ok) {
				status = 'failed';
				return;
			}
			const body = (await res.json()) as {
				mode?: string;
				identity?: { label?: string } | null;
			};
			identity = body.identity?.label ?? null;
			mode = body.mode ?? null;
			status = 'ready';
		} catch {
			status = 'failed';
		}
	});
</script>

{#if status === 'loading'}
	<p>Checking session…</p>
{:else if status === 'failed'}
	<p>Session check failed</p>
{:else}
	<p>Signed in as {identity}</p>
	<p>Session mode: {mode}</p>
{/if}
