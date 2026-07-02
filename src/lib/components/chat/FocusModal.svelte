<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogTitle,
		DialogDescription
	} from '$lib/components/ui/dialog/index.js';

	let {
		open,
		title,
		node,
		onClose
	}: {
		open: boolean;
		title: string;
		node: HTMLElement | null;
		onClose: () => void;
	} = $props();

	let viewport = $state<HTMLDivElement | null>(null);

	$effect(() => {
		const el = viewport;
		const n = node;
		if (el && n && open) {
			el.innerHTML = '';
			el.appendChild(n.cloneNode(true));
		}
	});
</script>

{#if open}
	<Dialog
		{open}
		onOpenChange={(v) => {
			if (!v) onClose();
		}}
	>
		<DialogContent class="w-auto max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden">
			<DialogTitle>{title}</DialogTitle>
			<DialogDescription>Scrollable view</DialogDescription>
			<div
				bind:this={viewport}
				class="markdown-body overflow-auto flex-1 min-h-0 mt-2 focus-modal-table"
				style="overflow-x: auto; overflow-y: auto;"
			></div>
		</DialogContent>
	</Dialog>
{/if}

<style>
	:global(.focus-modal-table th),
	:global(.focus-modal-table td) {
		max-width: 48rem;
		overflow-wrap: break-word;
		word-wrap: break-word;
		hyphens: auto;
	}
</style>
