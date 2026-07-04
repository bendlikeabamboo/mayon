<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	let { page = $bindable(1), totalPages = 1 }: { page?: number; totalPages?: number } = $props();
</script>

<div class="flex items-center justify-center gap-2 py-2">
	<Button variant="outline" size="sm" disabled={page <= 1} onclick={() => (page -= 1)}>Prev</Button>
	<span class="text-sm text-muted-foreground">
		Page {page} of {totalPages}
	</span>
	<Button variant="outline" size="sm" disabled={page >= totalPages} onclick={() => (page += 1)}>
		Next
	</Button>
</div>
