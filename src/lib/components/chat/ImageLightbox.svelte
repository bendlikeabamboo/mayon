<script lang="ts">
	import { Download } from '@lucide/svelte';
	import { imageDownloadName, type ImagePart } from '#lib/chat/kinds.js';

	/**
	 * Shared fullscreen image view: the click-to-close overlay extracted from
	 * UserMessage (018) and reused by assistant thumbnails (030). Renders
	 * nothing while `part` is null. `part` carries the full ImagePart; a
	 * native `<a download>` anchored beside the close overlay saves the image
	 * under its sanitized part name (030 T022).
	 */
	let { part, onClose }: { part: ImagePart | null; onClose: () => void } = $props();
</script>

{#if part}
	<div class="fixed inset-0 z-50">
		<button
			type="button"
			class="absolute inset-0 flex cursor-zoom-out items-center justify-center bg-black/70 p-8"
			onclick={onClose}
			aria-label="Close image view"
		>
			<img
				src={part.data}
				alt={part.name ?? 'Attached image'}
				class="max-h-full max-w-full rounded-lg object-contain shadow-xl"
			/>
		</button>
		<a
			href={part.data}
			download={imageDownloadName(part.name, part.mimeType)}
			class="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label="Download image"
		>
			<Download class="size-5" />
		</a>
	</div>
{/if}
