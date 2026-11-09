<script lang="ts">
	import type { ImagePart } from '#lib/chat/kinds.js';

	/**
	 * Shared fullscreen image view: the click-to-close overlay extracted from
	 * UserMessage (018) and reused by assistant thumbnails (030). Renders
	 * nothing while `part` is null. `part` carries the full ImagePart so
	 * future affordances (e.g. download) can hang off the same surface.
	 */
	let { part, onClose }: { part: ImagePart | null; onClose: () => void } = $props();
</script>

{#if part}
	<button
		type="button"
		class="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-8"
		onclick={onClose}
		aria-label="Close image view"
	>
		<img
			src={part.data}
			alt={part.name ?? 'Attached image'}
			class="max-h-full max-w-full rounded-lg object-contain shadow-xl"
		/>
	</button>
{/if}
