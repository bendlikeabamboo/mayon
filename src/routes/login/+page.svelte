<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Loader2 } from '@lucide/svelte';
	import { AuthApiError, confirmSetup, enroll, login, startSetup } from '$lib/auth/client';
	import { authState, refreshAuth } from '$lib/auth/state.svelte';
	import AuthQr from '$lib/components/AuthQr.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type View = 'login' | 'setup-credentials' | 'setup-confirm' | 'enroll';

	let forcedView = $state<View | null>(
		page.url.searchParams.get('mode') === 'setup' ? 'setup-credentials' : null
	);
	const view = $derived(
		forcedView ??
			(authState.loaded && authState.mode === 'open' && authState.setupRequired
				? 'setup-credentials'
				: 'login')
	);

	let loginLabel = $state('');
	let loginPassword = $state('');
	let loginCode = $state('');
	let loginBusy = $state(false);
	let loginError = $state<string | null>(null);

	let label = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let code = $state('');
	let otpauthUri = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let setupClosed = $state(false);

	let enrollOtpauthUri = $state<string | null>(null);
	let enrollIdentityLabel = $state('');
	let enrollCode = $state('');
	let enrollBusy = $state(false);
	let enrollError = $state<string | null>(null);

	const setupAvailable = $derived(
		authState.loaded && authState.mode === 'open' && authState.setupRequired
	);

	const inputClass =
		'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
	const labelClass = 'block text-xs font-medium text-muted-foreground';

	function describeLoginError(err: unknown): string {
		if (err instanceof AuthApiError) {
			if (err.status === 401) return 'Invalid credentials.';
			if (err.code === 'label required')
				return 'This app has multiple accounts — enter your label.';
			if (err.status === 429) return 'Too many attempts — wait a moment and try again.';
		}
		return err instanceof Error ? err.message : String(err);
	}

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

	function describeEnrollError(err: unknown): string {
		if (err instanceof AuthApiError && err.code === 'invalid code') {
			return "That code didn't verify. Wait for the next code and try again.";
		}
		return err instanceof Error ? err.message : String(err);
	}

	// The login response for an invitee without MFA carries no identity — recover
	// the label the user typed, else parse it from the otpauth URI (mayon:<label>).
	function labelFromOtpauth(uri: string): string | null {
		try {
			const path = decodeURIComponent(new URL(uri).pathname.replace(/^\//, ''));
			const idx = path.indexOf(':');
			const name = idx >= 0 ? path.slice(idx + 1) : path;
			return name || null;
		} catch {
			return null;
		}
	}

	async function submitLogin(event: SubmitEvent) {
		event.preventDefault();
		loginError = null;
		loginBusy = true;
		try {
			const res = await login({
				label: loginLabel.trim() || undefined,
				password: loginPassword,
				code: loginCode.trim()
			});
			if ('status' in res && res.status === 'mfa_enrollment_required') {
				enrollOtpauthUri = res.otpauthUri;
				enrollIdentityLabel =
					loginLabel.trim() || labelFromOtpauth(res.otpauthUri) || 'your account';
				enrollCode = '';
				enrollError = null;
				forcedView = 'enroll';
				return;
			}
			await refreshAuth();
			void goto('/');
		} catch (err) {
			loginError = describeLoginError(err);
		} finally {
			loginBusy = false;
		}
	}

	async function submitEnroll(event: SubmitEvent) {
		event.preventDefault();
		enrollError = null;
		enrollBusy = true;
		try {
			await enroll(enrollCode.trim());
			await refreshAuth();
			void goto('/');
		} catch (err) {
			if (err instanceof AuthApiError && err.status === 401) {
				forcedView = 'login';
				enrollOtpauthUri = null;
				enrollCode = '';
				loginError = 'Enrollment session expired — log in again.';
			} else {
				enrollError = describeEnrollError(err);
			}
		} finally {
			enrollBusy = false;
		}
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
			forcedView = 'setup-confirm';
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
		forcedView = 'setup-credentials';
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
		{:else if view === 'login'}
			<div class="space-y-1 text-center">
				<h1 class="text-lg font-semibold">Sign in to Mayon</h1>
				<p class="text-sm text-muted-foreground">
					Enter your password and the current six-digit code from your authenticator.
				</p>
			</div>
			<form class="space-y-3" onsubmit={submitLogin}>
				<div class="space-y-1">
					<label class={labelClass} for="login-label">Label</label>
					<input
						id="login-label"
						bind:value={loginLabel}
						placeholder="Leave blank if you're the only user"
						autocomplete="username"
						class={inputClass}
					/>
				</div>
				<div class="space-y-1">
					<label class={labelClass} for="login-password">Password</label>
					<input
						id="login-password"
						type="password"
						bind:value={loginPassword}
						required
						autocomplete="current-password"
						class={inputClass}
					/>
				</div>
				<div class="space-y-1">
					<label class={labelClass} for="login-code">Six-digit code</label>
					<input
						id="login-code"
						bind:value={loginCode}
						required
						inputmode="numeric"
						pattern={'[0-9]{6}'}
						maxlength={6}
						autocomplete="one-time-code"
						class="{inputClass} text-center font-mono tracking-[0.3em]"
					/>
				</div>
				{#if loginError}
					<p class="text-xs text-destructive" role="alert">{loginError}</p>
				{/if}
				<Button
					type="submit"
					class="w-full"
					disabled={loginBusy || loginPassword.length === 0 || loginCode.trim().length !== 6}
				>
					{#if loginBusy}<Loader2 class="size-4" />{/if}
					Sign in
				</Button>
			</form>
			{#if setupAvailable}
				<Button variant="ghost" class="w-full" onclick={() => (forcedView = 'setup-credentials')}>
					Set up security instead
				</Button>
			{/if}
		{:else if view === 'enroll' && enrollOtpauthUri}
			<div class="space-y-1 text-center">
				<h1 class="text-lg font-semibold">Enrolling authenticator for {enrollIdentityLabel}</h1>
				<p class="text-sm text-muted-foreground">
					Scan the code with your authenticator app, then enter the current six-digit code to finish
					setting up your account.
				</p>
			</div>
			<AuthQr uri={enrollOtpauthUri} />
			<form class="space-y-3" onsubmit={submitEnroll}>
				<div class="space-y-1">
					<label class={labelClass} for="enroll-code">Six-digit code</label>
					<input
						id="enroll-code"
						bind:value={enrollCode}
						required
						inputmode="numeric"
						pattern={'[0-9]{6}'}
						maxlength={6}
						autocomplete="one-time-code"
						class="{inputClass} text-center font-mono tracking-[0.3em]"
					/>
				</div>
				{#if enrollError}
					<p class="text-xs text-destructive" role="alert">{enrollError}</p>
				{/if}
				<Button
					type="submit"
					class="w-full"
					disabled={enrollBusy || enrollCode.trim().length !== 6}
				>
					{#if enrollBusy}<Loader2 class="size-4" />{/if}
					Verify and finish
				</Button>
			</form>
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
				<Button variant="outline" size="sm" onclick={() => (forcedView = 'login')}>
					Go to sign-in
				</Button>
			</div>
		{:else if view === 'setup-credentials'}
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
						pattern={'[0-9]{6}'}
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
