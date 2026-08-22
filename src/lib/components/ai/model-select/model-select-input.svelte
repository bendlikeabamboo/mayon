<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		value = $bindable(''),
		...restProps
	}: { class?: string; value?: string; [key: string]: unknown } = $props();
</script>

<Command.Input bind:value class={cn('h-auto py-3.5', className)} {...restProps} />
