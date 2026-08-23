<script lang="ts">
	import * as Dialog from "$COMPONENTS$/ui/dialog/index.js";
	import * as Command from "$COMPONENTS$/ui/command/index.js";
	import type { Dialog as DialogPrimitive } from "bits-ui";
	import type { WithoutChildrenOrChild } from "$UTILS$";
	import type { Snippet } from "svelte";
	import { cn } from "$UTILS$";

	let {
		ref = $bindable(null),
		class: className,
		children,
		portalProps,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		children: Snippet;
		portalProps?: DialogPrimitive.PortalProps;
	} = $props();
</script>

<Dialog.Content
	bind:ref
	class={cn("outline-border! border-none! p-0 outline! outline-solid!", className)}
	{portalProps}
	{...restProps}
>
	<Command.Root class="**:data-[slot=command-input-wrapper]:h-auto">
		{@render children()}
	</Command.Root>
</Dialog.Content>
