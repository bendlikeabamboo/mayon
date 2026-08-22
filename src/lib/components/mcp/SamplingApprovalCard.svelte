<script lang="ts">
	import {
		Confirmation,
		ConfirmationTitle,
		ConfirmationRequest,
		ConfirmationActions,
		ConfirmationAction,
		ConfirmationAccepted,
		ConfirmationRejected,
		ConfirmationFailed,
		createApprovalStateMachine
	} from '$lib/components/mcp/confirmation/index.js';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible/index.js';
	import type { PublicMcpSamplingEntry } from '$lib/stores/chat.svelte';
	import { serverStatus } from '$lib/services/status.svelte';

	type Props = {
		entry: PublicMcpSamplingEntry;
		onApprove: () => void;
		onDecline: () => void;
		onError?: () => void;
	};

	let { entry, onApprove, onDecline, onError }: Props = $props();

	const sm = createApprovalStateMachine();

	function handleApprove() {
		if (sm.state !== 'pending') return;
		sm.succeed();
		onApprove();
	}

	function handleDecline() {
		if (sm.state !== 'pending') return;
		sm.reject();
		onDecline();
	}

	sm.onAction = () => {};

	$effect(() => {
		if (sm.state === 'failed') onError?.();
	});
</script>

<Confirmation {sm} class="rounded-md border border-border bg-card">
	<div class="flex items-center gap-2">
		<span
			class="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
		>
			MCP Sampling
		</span>
		<ConfirmationTitle>
			<span class="font-medium">{entry.serverName}</span>
		</ConfirmationTitle>
	</div>

	<ConfirmationRequest>
		<p class="text-xs text-muted-foreground">
			Token budget: {entry.remainingBudget} remaining (max {entry.maxTokens} per call)
		</p>
		<Collapsible>
			<CollapsibleTrigger class="mt-1 cursor-pointer text-xs text-muted-foreground">
				Server prompt preview
			</CollapsibleTrigger>
			<CollapsibleContent>
				<pre
					class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{entry.prompt}</pre>
			</CollapsibleContent>
		</Collapsible>
	</ConfirmationRequest>

	<ConfirmationActions>
		<ConfirmationAction onclick={handleApprove} disabled={serverStatus.restoring}
			>Approve</ConfirmationAction
		>
		<ConfirmationAction variant="outline" onclick={handleDecline} disabled={serverStatus.restoring}
			>Decline</ConfirmationAction
		>
	</ConfirmationActions>

	<ConfirmationAccepted>
		<p class="text-xs text-muted-foreground">Approved.</p>
	</ConfirmationAccepted>

	<ConfirmationRejected>
		<p class="text-xs text-muted-foreground">Declined.</p>
	</ConfirmationRejected>

	<ConfirmationFailed>
		<p class="text-xs text-destructive">Request failed.</p>
	</ConfirmationFailed>
</Confirmation>
