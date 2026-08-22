<script lang="ts">
	import type { Command as CommandPrimitive, Dialog as DialogPrimitive } from 'bits-ui';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';
	import type { Snippet } from 'svelte';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription
	} from '$lib/components/ui/dialog/index.js';
	import Command from '$lib/components/ui/command/command.svelte';

	let {
		open = $bindable(false),
		ref = $bindable(null),
		value = $bindable(''),
		shouldFilter = false,
		title = 'Select a model',
		description = 'Search for a model',
		portalProps,
		children,
		...rest
	}: WithoutChildrenOrChild<DialogPrimitive.RootProps> &
		WithoutChildrenOrChild<CommandPrimitive.RootProps> & {
			portalProps?: DialogPrimitive.PortalProps;
			children: Snippet;
			title?: string;
			description?: string;
		} = $props();
</script>

<Dialog bind:open {...rest}>
	<DialogHeader class="sr-only">
		<DialogTitle>{title}</DialogTitle>
		<DialogDescription>{description}</DialogDescription>
	</DialogHeader>
	<DialogContent class="overflow-hidden p-0" {portalProps}>
		<Command
			class="**:data-[slot=command-input-wrapper]:h-12 [&_[data-command-group]]:px-2 [&_[data-command-group]:not([hidden])_~[data-command-group]]:pt-0 [&_[data-command-input-wrapper]_svg]:h-5 [&_[data-command-input-wrapper]_svg]:w-5 [&_[data-command-input]]:h-12 [&_[data-command-item]]:px-2 [&_[data-command-item]]:py-3 [&_[data-command-item]_svg]:h-5 [&_[data-command-item]_svg]:w-5"
			{...rest}
			{shouldFilter}
			bind:value
			bind:ref
			{children}
		/>
	</DialogContent>
</Dialog>
