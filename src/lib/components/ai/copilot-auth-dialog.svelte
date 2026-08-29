<script lang="ts">
	// GitHub Copilot device-flow dialog (016 US1). Presentational state only:
	// the only persisted artifact is the KeyStore grant written on success.
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { setProviderKey } from '$lib/ai/client';
	import type {
		CopilotAuthPollRequest,
		CopilotAuthPollResponse,
		CopilotAuthStartResponse,
		CopilotErrorResponse
	} from '@mayon/shared';

	const START_ENDPOINT = '/api/llm/copilot/auth/start';
	const POLL_ENDPOINT = '/api/llm/copilot/auth/poll';
	const DEFAULT_INTERVAL_SECONDS = 5;
	const SUCCESS_CLOSE_MS = 1200;

	type Props = {
		providerId: string;
		open: boolean;
		onSuccess?: (login?: string) => void;
		onClose: () => void;
	};

	let { providerId, open, onSuccess, onClose }: Props = $props();

	type Phase = 'starting' | 'code' | 'error' | 'success';

	let phase = $state<Phase>('starting');
	let userCode = $state('');
	let verificationUri = $state('');
	let errorMessage = $state('');
	let errorKind = $state<'start' | 'flow'>('start');
	let copied = $state(false);

	// Flow lifecycle: every start/restart bumps `generation`, and async steps
	// from an older generation are ignored. Closing aborts the in-flight
	// request and clears every pending timer.
	let generation = 0;
	let flowId: string | null = null;
	let interval = DEFAULT_INTERVAL_SECONDS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;

	$effect(() => {
		if (open) void startFlow();
		return clearFlow;
	});

	async function startFlow(): Promise<void> {
		clearTimer();
		controller?.abort();
		controller = new AbortController();
		const gen = ++generation;
		flowId = null;
		phase = 'starting';
		errorMessage = '';
		copied = false;
		let res: Response;
		try {
			res = await fetch(START_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({}),
				signal: controller.signal
			});
		} catch {
			if (gen !== generation) return;
			phase = 'error';
			errorKind = 'start';
			errorMessage = 'This requires the companion server. Start it and retry.';
			return;
		}
		if (gen !== generation) return;
		if (!res.ok) {
			const message = await startErrorMessage(res);
			if (gen !== generation) return;
			phase = 'error';
			errorKind = 'start';
			errorMessage = message;
			return;
		}
		const data = await readJson<CopilotAuthStartResponse>(res);
		if (!data || gen !== generation) return;
		flowId = data.flowId;
		userCode = data.userCode;
		verificationUri = data.verificationUri;
		interval = data.interval > 0 ? data.interval : DEFAULT_INTERVAL_SECONDS;
		phase = 'code';
		schedulePoll(gen);
	}

	async function poll(gen: number): Promise<void> {
		if (gen !== generation || !flowId) return;
		let res: Response;
		try {
			res = await fetch(POLL_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ flowId } satisfies CopilotAuthPollRequest),
				signal: controller?.signal
			});
		} catch {
			// Transient network failure — keep waiting at the same cadence.
			if (gen === generation) schedulePoll(gen);
			return;
		}
		if (gen !== generation) return;
		if (res.status === 404) {
			// unknown_flow — the server dropped it; same recovery as expiry.
			phase = 'error';
			errorKind = 'flow';
			errorMessage = 'The code expired — start again.';
			return;
		}
		if (!res.ok) {
			// Upstream hiccup — keep polling; the flow expires on its own.
			schedulePoll(gen);
			return;
		}
		const data = await readJson<CopilotAuthPollResponse>(res);
		if (!data || gen !== generation) return;
		if (data.status === 'pending') {
			if ('slowDownAfter' in data && data.slowDownAfter > 0) interval = data.slowDownAfter;
			schedulePoll(gen);
			return;
		}
		if (data.status === 'complete') {
			await setProviderKey(providerId, data.githubToken);
			if (gen !== generation) return;
			phase = 'success';
			onSuccess?.(data.user.login);
			clearTimer();
			timer = setTimeout(onClose, SUCCESS_CLOSE_MS);
			return;
		}
		phase = 'error';
		errorKind = 'flow';
		errorMessage =
			data.status === 'denied'
				? 'Authorization was declined on GitHub.'
				: 'The code expired — start again.';
	}

	function schedulePoll(gen: number) {
		clearTimer();
		timer = setTimeout(() => void poll(gen), interval * 1000);
	}

	async function copyCode(): Promise<void> {
		try {
			await navigator.clipboard.writeText(userCode);
		} catch {
			return;
		}
		copied = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
			copyTimer = null;
		}, 1500);
	}

	function handleOpenChange(next: boolean) {
		if (!next) onClose();
	}

	function clearTimer() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (copyTimer !== null) {
			clearTimeout(copyTimer);
			copyTimer = null;
		}
	}

	function clearFlow() {
		clearTimer();
		generation++;
		controller?.abort();
		controller = null;
		flowId = null;
	}

	async function startErrorMessage(res: Response): Promise<string> {
		try {
			const body = (await res.json()) as CopilotErrorResponse;
			if (body?.error === 'upstream' && body.message) {
				return `GitHub could not start the flow: ${body.message}`;
			}
		} catch {
			// fall through to the generic message
		}
		return 'Could not start authorization. Check the companion server.';
	}

	async function readJson<T>(res: Response): Promise<T | null> {
		try {
			return (await res.json()) as T;
		} catch {
			return null;
		}
	}
</script>

<Dialog {open} onOpenChange={handleOpenChange}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Connect GitHub account</DialogTitle>
			<DialogDescription>
				Authorize this app with your GitHub account — no key to copy or paste.
			</DialogDescription>
		</DialogHeader>

		{#if phase === 'starting'}
			<p class="text-sm text-muted-foreground" role="status">Starting authorization…</p>
		{:else if phase === 'code'}
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<code
						class="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-lg tracking-widest"
					>
						{userCode}
					</code>
					<Button variant="outline" size="sm" onclick={() => void copyCode()}>
						{copied ? 'Copied' : 'Copy'}
					</Button>
				</div>
				<p class="text-sm text-muted-foreground">
					Open
					<a
						class="hover:underline"
						href={verificationUri}
						target="_blank"
						rel="noopener noreferrer">{verificationUri}</a
					>
					and enter the code to continue.
				</p>
				<p class="text-xs text-muted-foreground" role="status">Waiting for authorization…</p>
			</div>
		{:else if phase === 'error'}
			<p class="text-sm text-destructive">{errorMessage}</p>
		{:else if phase === 'success'}
			<p class="text-sm text-emerald-600 dark:text-emerald-400" role="status">Connected.</p>
		{/if}

		<DialogFooter>
			{#if phase === 'error'}
				<Button variant="outline" size="sm" onclick={() => void startFlow()}>
					{errorKind === 'start' ? 'Retry' : 'Restart'}
				</Button>
			{/if}
			<Button variant="ghost" size="sm" onclick={() => onClose()}>Cancel</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
