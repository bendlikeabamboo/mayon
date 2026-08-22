<script lang="ts">
	import * as Command from "$COMPONENTS$/ui/command/index.js";
	import type { Command as CommandPrimitive } from "bits-ui";
	import type { WithoutChildrenOrChild } from "$UTILS$";
	import { cn } from "$UTILS$";

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: WithoutChildrenOrChild<CommandPrimitive.InputProps> = $props();
</script>

<Command.Input bind:ref bind:value class={cn("h-auto py-3.5", className)} {...restProps} />
