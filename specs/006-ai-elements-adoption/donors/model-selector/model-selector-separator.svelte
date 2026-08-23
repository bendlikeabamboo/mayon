<script lang="ts">
	import * as Command from "$COMPONENTS$/ui/command/index.js";
	import type { Command as CommandPrimitive } from "bits-ui";
	import type { WithoutChildrenOrChild } from "$UTILS$";

	let {
		ref = $bindable(null),
		...restProps
	}: WithoutChildrenOrChild<CommandPrimitive.SeparatorProps> = $props();
</script>

<Command.Separator bind:ref {...restProps} />
