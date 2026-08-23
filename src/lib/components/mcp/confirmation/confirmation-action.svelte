<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ButtonVariant } from '$lib/components/ui/button/button.svelte';
	import type { ButtonSize } from '$lib/components/ui/button/button.svelte';

	let {
		class: className,
		variant = 'default',
		size = 'sm',
		disabled = false,
		children,
		...restProps
	}: {
		class?: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		disabled?: boolean;
		children?: Snippet;
	} & Record<string, unknown> = $props();
</script>

<Button class={className} type="button" {variant} {size} {disabled} {...restProps}>
	{@render children?.()}
</Button>
