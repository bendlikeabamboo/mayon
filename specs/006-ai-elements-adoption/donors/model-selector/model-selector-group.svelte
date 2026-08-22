<script lang="ts">
	import * as Command from "$COMPONENTS$/ui/command/index.js";
	import type { Command as CommandPrimitive } from "bits-ui";
	import type { WithoutChildrenOrChild } from "$UTILS$";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		heading,
		children,
		...restProps
	}: WithoutChildrenOrChild<CommandPrimitive.GroupProps> & {
		children: Snippet;
		heading?: string;
	} = $props();
</script>

<Command.Group bind:ref {heading} {...restProps}>
	{@render children()}
</Command.Group>
