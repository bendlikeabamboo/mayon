<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription
	} from '$lib/components/ui/dialog/index.js';
	import { serverStatus } from '$lib/services/status.svelte';
	import {
		ConfirmationRequest,
		ConfirmationActions,
		ConfirmationAction,
		ConfirmationAccepted,
		ConfirmationRejected,
		ConfirmationFailed,
		createApprovalStateMachine,
		setConfirmationContext
	} from '$lib/components/mcp/confirmation/index.js';
	import ElicitationForm from './ElicitationForm.svelte';
	import type { PublicElicitationEntry } from '$lib/stores/chat.svelte';

	type Props = {
		entry: PublicElicitationEntry;
		onSubmit: (data: Record<string, unknown>) => void;
		onCancel: () => void;
		onError?: () => void;
	};

	let { entry, onSubmit, onCancel, onError }: Props = $props();

	const sm = createApprovalStateMachine();
	setConfirmationContext(sm);

	let formData = $state<Record<string, unknown>>({});
	let useJsonFallback = $state(false);
	let jsonText = $state('{}');
	let jsonError = $state<string | null>(null);

	function handleSubmit(): void {
		if (sm.state !== 'pending') return;
		if (useJsonFallback) {
			try {
				const parsed = JSON.parse(jsonText);
				jsonError = null;
				sm.succeed();
				onSubmit(parsed);
			} catch (err) {
				jsonError = err instanceof Error ? err.message : 'Invalid JSON';
			}
			return;
		}
		sm.succeed();
		onSubmit(formData);
	}

	function handleCancel(): void {
		if (sm.state !== 'pending') return;
		sm.reject();
		onCancel();
	}

	sm.onAction = () => {};

	$effect(() => {
		if (sm.state === 'failed') onError?.();
	});
</script>

<Dialog open>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Server Input Request</DialogTitle>
			<DialogDescription>
				{entry.serverName}: {entry.message}
			</DialogDescription>
		</DialogHeader>

		<ConfirmationRequest>
			<p class="text-sm">{entry.message}</p>
		</ConfirmationRequest>

		<ElicitationForm
			schema={entry.schema}
			bind:formData
			bind:useJsonFallback
			bind:jsonText
			bind:jsonError
		/>

		<ConfirmationActions>
			<ConfirmationAction variant="outline" onclick={handleCancel} disabled={serverStatus.restoring}
				>Cancel</ConfirmationAction
			>
			<ConfirmationAction onclick={handleSubmit} disabled={serverStatus.restoring}
				>Submit</ConfirmationAction
			>
		</ConfirmationActions>

		<ConfirmationAccepted>
			<p class="text-xs text-muted-foreground">Submitted.</p>
		</ConfirmationAccepted>

		<ConfirmationRejected>
			<p class="text-xs text-muted-foreground">Cancelled.</p>
		</ConfirmationRejected>

		<ConfirmationFailed>
			<p class="text-xs text-destructive">Request failed.</p>
		</ConfirmationFailed>
	</DialogContent>
</Dialog>
