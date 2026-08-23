<script lang="ts">
	import * as Command from "$COMPONENTS$/ui/command/index.js";
	import type { WithElementRef } from "$UTILS$";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<Command.Shortcut bind:ref {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</Command.Shortcut>
