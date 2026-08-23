<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';

	let { ...restProps }: Record<string, unknown> = $props();
</script>

<Command.Separator {...restProps} />
