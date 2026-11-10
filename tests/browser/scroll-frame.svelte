<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		height = '160px',
		children
	}: {
		height?: string;
		children?: Snippet;
	} = $props();
</script>

<div class="overflow-y-auto" style="height:{height};overflow-y:auto;">
	{@render children?.()}
</div>
