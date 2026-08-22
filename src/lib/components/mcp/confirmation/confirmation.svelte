<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ApprovalStateMachine } from './confirmation-context.svelte.js';
	import { Alert } from '$lib/components/ui/alert/index.js';
	import { setConfirmationContext } from './confirmation-context.svelte.js';

	let {
		class: className,
		sm,
		children,
		...restProps
	}: {
		class?: string;
		sm: ApprovalStateMachine;
		children?: Snippet;
	} & Record<string, unknown> = $props();

	// svelte-ignore state_referenced_locally
	setConfirmationContext(sm);
</script>

<Alert class={className} {...restProps}>
	{@render children?.()}
</Alert>
