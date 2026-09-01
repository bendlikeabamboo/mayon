<script lang="ts">
	import { goto } from '$app/navigation';
	import { Loader2 } from '@lucide/svelte';
	import { AuthApiError, confirmSetup, startSetup } from '$lib/auth/client';
	import { authState, refreshAuth } from '$lib/auth/state.svelte';
	import AuthQr from '$lib/components/AuthQr.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	// This page serves the one-time setup flow (US1). The daily credentials
	// login mode arrives with US3 and will slot in as a sibling of `step`.
	let step = $state<'credentials' | 'confirm'>('credentials');
	let label = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let code = $state('');
	let otpauthUri = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let setupClosed = $state(false);

	const setupAvailable = $derived(
		authState.loaded && authState.mode === 'open' && authState.setupRequired
	);

	const inputClass =
		'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
	const labelClass = 'block text-xs font-medium text-muted-foreground';

	function describeSetupError(err: unknown): string {
		if (err instanceof AuthApiError) {
			if (err.code === 'invalid label') return 'Use a name between 1 and 64 characters.';
			if (err.code === 'invalid password') return 'Use a password of 8–1024 characters.';
			if (err.code === 'invalid code')
				return "That code didn't verify. Wait for the next code and try again.";
			if (err.code === 'setup closed') return 'Security setup is already closed.';
		}
		return err instanceof Error ? err.message : String(err);
	}

	async function submitCredentials(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		const name = label.trim();
		if (name.length < 1 || name.length > 64) {
			error = 'Use a name between 1 and 64 characters.';
			return;
		}
		if (password.length < 8 || password.length > 1024) {
			error = 'Use a password of 8–1024 characters.';
			return;
		}
		if (password !== passwordConfirm) {
			error = 'Passwords do not match.';
			return;
		}
		busy = true;
		try {
			const res = await startSetup({ label: name, password });
			otpauthUri = res.otpauthUri;
			code = '';
			step = 'confirm';
		} catch (err) {
			if (err instanceof AuthApiError && err.status === 409) setupClosed = true;
			else error = describeSetupError(err);
		} finally {
			busy = false;
		}
	}

	async function submitCode(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		busy = true;
		try {
			await confirmSetup(code.trim());
			await refreshAuth();
			void goto('/');
		} catch (err) {
			if (err instanceof AuthApiError && err.status === 409) setupClosed = true;
			else error = describeSetupError(err);
		} finally {
			busy = false;
		}
	}

	function backToCredentials() {
		step = 'credentials';
		otpauthUri = null;
		error = null;
	}
</script>

<div class="fixed inset-0 grid place-items-center bg-background p-6">
	<div class="w-full max-w-sm space-y-4 rounded-lg border border-border p-6">
		{#if !authState.loaded}
			<div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
				<Loader2 class="size-4 animate-spin" />
				Checking security status…
			</div>
		{:else if !setupAvailable || setupClosed}
			<div class="space-y-3 text-center">
				<h1 class="text-lg font-semibold">Security setup is not available.</h1>
				<p class="text-sm text-muted-foreground">
					{#if setupClosed}
						Setup is one-time and has already been completed or closed.
					{:else}
						This app already runs with security configured.
					{/if}
				</p>
				<Button variant="outline" size="sm" onclick={() => goto('/')}>Go home</Button>
			</div>
		{:else if step === 'credentials'}
			<div class="space-y-1 text-center">
				<h1 class="text-lg font-semibold">Set up security</h1>
				<p class="text-sm text-muted-foreground">
					Choose a name and password, then enroll an authenticator app. Setup runs once; afterwards
					this app requires login.
				</p>
			</div>
			<form class="space-y-3" onsubmit={submitCredentials}>
				<div class="space-y-1">
					<label class={labelClass} for="setup-label">Name</label>
					<input
						id="setup-label"
						bind:value={label}
						required
						maxlength={64}
						placeholder="e.g. owner"
						autocomplete="username"
						class={inputClass}
					/>
				</div>
				<div class="space-y-1">
					<label class={labelClass} for="setup-password">Password</label>
					<input
						id="setup-password"
						type="password"
						bind:value={password}
						required
						placeholder="At least 8 characters"
						autocomplete="new-password"
						class={inputClass}
					/>
				</div>
				<div class="space-y-1">
					<label class={labelClass} for="setup-password-confirm">Confirm password</label>
					<input
						id="setup-password-confirm"
						type="password"
						bind:value={passwordConfirm}
						required
						autocomplete="new-password"
						class={inputClass}
					/>
				</div>
				{#if error}
					<p class="text-xs text-destructive" role="alert">{error}</p>
				{/if}
				<Button type="submit" class="w-full" disabled={busy}>
					{#if busy}<Loader2 class="size-4" />{/if}
					Continue
				</Button>
			</form>
		{:else if otpauthUri}
			<div class="space-y-1 text-center">
				<h1 class="text-lg font-semibold">Scan with your authenticator</h1>
				<p class="text-sm text-muted-foreground">
					Add the code below with your authenticator app, then enter the current six-digit code.
				</p>
			</div>
			<AuthQr uri={otpauthUri} />
			<form class="space-y-3" onsubmit={submitCode}>
				<div class="space-y-1">
					<label class={labelClass} for="setup-code">Six-digit code</label>
					<input
						id="setup-code"
						bind:value={code}
						required
						inputmode="numeric"
						pattern="\d{6}"
						maxlength={6}
						autocomplete="one-time-code"
						class="{inputClass} text-center font-mono tracking-[0.3em]"
					/>
				</div>
				{#if error}
					<p class="text-xs text-destructive" role="alert">{error}</p>
				{/if}
				<Button type="submit" class="w-full" disabled={busy || code.trim().length !== 6}>
					{#if busy}<Loader2 class="size-4" />{/if}
					Verify and enable
				</Button>
				<Button type="button" variant="ghost" class="w-full" onclick={backToCredentials}>
					Use a different password
				</Button>
			</form>
		{/if}
	</div>
</div>
