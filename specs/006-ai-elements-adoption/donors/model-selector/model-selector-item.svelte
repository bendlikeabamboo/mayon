<script lang="ts">
	import * as Command from "$COMPONENTS$/ui/command/index.js";
	import type { Command as CommandPrimitive } from "bits-ui";
	import type { WithoutChildrenOrChild } from "$UTILS$";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: WithoutChildrenOrChild<CommandPrimitive.ItemProps> & {
		children: Snippet;
	} = $props();
</script>

<Command.Item bind:ref {...restProps}>
	{@render children()}
</Command.Item>
