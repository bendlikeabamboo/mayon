<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, GitBranch, RotateCcw } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import Markdown from '../Markdown.svelte';
	import Reasoning from '../Reasoning.svelte';
	import GrowthEdge from '../GrowthEdge.svelte';
	import Highlighter from '../Highlighter.svelte';
	import Spinner from '../Spinner.svelte';
	import SectionStrip from '../strip/SectionStrip.svelte';
	import ImageLightbox from '../ImageLightbox.svelte';
	import type { DurableEntry } from '#lib/chat/entries.js';
	import type { ResolvedOffsets } from '#lib/chat/selection.js';
	import type { ExpoundOptions } from '#lib/chat/expound.js';
	import { extractSections, isStripCandidate } from '#lib/markdown/sections.js';
	import { stripGateFence } from '#lib/ai/generate/generate-gate.js';
	import {
		parseMetadata,
		partsOf,
		type ImagePart,
		type MessagePart,
		type TextPart
	} from '#lib/chat/kinds.js';
	import type { AssistantMessageMeta } from '#lib/chat/kinds.js';
	import { incRender } from '#lib/perf/mark.js';
	import { chatStore } from '#lib/stores/chat.svelte.js';

	interface SharedCallbacks {
		onExpound: (
			messageId: string,
			raw: string,
			resolved: ResolvedOffsets,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
		onRegenerate?: (messageId: string) => void | Promise<void>;
	}

	type DurableProps = {
		item: DurableEntry;
		live?: false;
		personaName?: string;
		failed?: boolean;
		/**
		 * Regenerate reveal gate threaded from MessageList: true only when this
		 * row is the newest assistant turn and generation is idle. The page's
		 * `onRegenerate` (delete reply + re-send preceding user turn) is only
		 * chronology-safe in that position, so older rows keep the action hidden
		 * even though the prop contract itself is unchanged.
		 */
		canRegenerate?: boolean;
		onJumpToSection?: (msgId: string, index: number) => void;
		/** Persisted strip preference (US3): false unmounts every strip. */
		stripEnabled?: boolean;
	} & SharedCallbacks;

	type LiveProps = {
		live: true;
		buffer: string;
		pending?: boolean;
		personaName?: string;
	};

	let props: DurableProps | LiveProps = $props();

	const isDurable = $derived(props.live !== true);
	const entry = $derived(isDurable ? (props as DurableProps).item.entry : null);
	const meta = $derived(isDurable ? parseMetadata<AssistantMessageMeta>(entry!.metadata) : null);
	const reasoning = $derived(meta?.reasoning);
	const interrupted = $derived(meta?.interrupted === true);
	const visible = $derived(
		isDurable ? stripGateFence(entry!.content) : stripGateFence((props as LiveProps).buffer)
	);
	const pending = $derived(!isDurable ? ((props as LiveProps).pending ?? false) : false);
	const personaName = $derived(
		isDurable
			? ((props as DurableProps).personaName ?? 'Mayon')
			: ((props as LiveProps).personaName ?? 'Mayon')
	);

	let reasoningOpen = $state(false);
	let expanded = $state<ImagePart | null>(null);

	type BodySegment = { kind: 'text'; text: string } | { kind: 'images'; images: ImagePart[] };

	// The open union's `{ type: string }` member defeats discriminant
	// narrowing; use explicit predicates (house pattern, cf. kinds.ts).
	const asImage = (p: MessagePart): p is ImagePart => p.type === 'image';
	const asText = (p: MessagePart): p is TextPart => p.type === 'text';

	const rowParts = $derived(isDurable ? partsOf(entry!) : []);
	const hasImages = $derived(rowParts.some((p) => p.type === 'image'));

	/**
	 * Ordered render segments (030 contract §4): contiguous text parts become
	 * one Markdown block each, image parts become thumbnail grids between them.
	 * Null ⇒ the single-block legacy render below (image-less rows are
	 * untouched). Text runs concatenate byte-for-byte to `visible` —
	 * stripGateFence's truncation slices the run list at the same boundary —
	 * which keeps expound's sourcemap + DOM alignment derivable by
	 * construction; a split that misaligns markdown (e.g. mid-`**` emphasis)
	 * simply fails alignment and hits the existing 'unaligned' menu-disable
	 * path in selection.ts. Images contribute no text nodes, so grids between
	 * segments are invisible to the alignment walk.
	 */
	const segments = $derived.by(() => {
		if (!isDurable || !hasImages) return null;
		const segs: BodySegment[] = [];
		let run = '';
		let images: ImagePart[] = [];
		let textTotal = 0;
		const flushText = () => {
			if (run !== '') {
				segs.push({ kind: 'text', text: run });
				run = '';
			}
		};
		const flushImages = () => {
			if (images.length > 0) {
				segs.push({ kind: 'images', images });
				images = [];
			}
		};
		for (const part of rowParts) {
			if (asImage(part)) {
				flushText();
				images.push(part);
			} else if (asText(part)) {
				flushImages();
				run += part.text;
				textTotal += part.text.length;
			}
		}
		flushText();
		flushImages();
		if (textTotal > visible.length) {
			let remaining = visible.length;
			const out: BodySegment[] = [];
			for (const seg of segs) {
				if (seg.kind === 'text') {
					if (remaining <= 0) continue;
					const text = seg.text.slice(0, remaining);
					remaining -= text.length;
					out.push({ kind: 'text', text });
				} else {
					out.push(seg);
				}
			}
			for (let i = out.length - 1; i >= 0; i--) {
				const seg = out[i]!;
				if (seg.kind === 'images') continue;
				seg.text = seg.text.trimEnd();
				break;
			}
			return out;
		}
		return segs;
	});

	const sections = $derived(isDurable ? extractSections(visible) : []);
	const stripCandidate = $derived(isDurable && isStripCandidate(sections));
	const stripPrefOn = $derived(isDurable && ((props as DurableProps).stripEnabled ?? true));
	let stripMeasured = $state(false);
	const stripEligible = $derived(stripPrefOn && stripMeasured);
	let bodyEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!stripCandidate) {
			stripMeasured = false;
			return;
		}
		const el = bodyEl;
		if (!el) return;
		const scroller = el.closest<HTMLElement>('.overflow-y-auto');
		if (!scroller) return;
		const measure = () => {
			stripMeasured = el.offsetHeight > scroller.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	onMount(() => incRender('TimelineRow'));
</script>

<div class="group/message relative flex flex-col gap-1 items-start">
	<div class="flex w-full items-center justify-between">
		<div class="flex items-center">
			<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{personaName}
			</span>
			{#if !isDurable && !pending && visible}
				<Spinner variant="orbit" class="ml-1.5" />
			{/if}
			{#if reasoning}
				<Reasoning {reasoning} inline bind:open={reasoningOpen} />
			{/if}
		</div>
	</div>
	{#if reasoning && reasoningOpen}
		<div
			class="max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-muted-foreground italic"
		>
			<Markdown raw={reasoning} />
		</div>
	{/if}
	<div
		bind:this={bodyEl}
		class="min-w-0 max-w-full rounded-lg px-4 py-2.5 border border-border bg-background text-foreground {isDurable &&
		(props as DurableProps).failed
			? 'border-l-2 border-red-500/60'
			: ''}"
	>
		{#if !isDurable && pending}
			<span class="flex items-center gap-1.5 text-sm text-muted-foreground">
				<Spinner variant="pulse" />
				Thinking…
			</span>
		{:else if isDurable}
			<Highlighter
				raw={visible}
				messageId={entry!.id}
				onExpound={(raw, sel, opts) => (props as DurableProps).onExpound(entry!.id, raw, sel, opts)}
				onCopy={(props as DurableProps).onCopy}
			>
				{#if segments}
					{#each segments as seg, i (i)}
						{#if seg.kind === 'text'}
							<Markdown raw={seg.text} onFixMermaid={(prompt) => void chatStore.send(prompt)} />
						{:else}
							<div class="flex flex-wrap gap-1.5">
								{#each seg.images as image (image.data)}
									<button
										type="button"
										class="overflow-hidden rounded-lg border border-border transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										onclick={() => (expanded = image)}
										aria-label="View image full size"
									>
										<img
											src={image.data}
											alt={image.name ?? 'Generated image'}
											class="size-24 object-cover"
											loading="lazy"
										/>
									</button>
								{/each}
							</div>
						{/if}
					{/each}
				{:else}
					<Markdown raw={visible} onFixMermaid={(prompt) => void chatStore.send(prompt)} />
				{/if}
			</Highlighter>
		{:else}
			<div class="group/live relative">
				<Markdown raw={visible} live={true} />
				{#if chatStore.streamPreset !== 'standard'}
					<GrowthEdge
						variant={chatStore.streamPreset === 'expressive' ? 'blur-fade' : 'caret'}
						buffer={visible}
						lifting={chatStore.streamPhase === 'draining'}
					/>
				{/if}
			</div>
		{/if}
	</div>
	{#if isDurable && stripEligible}
		<SectionStrip
			msgId={entry!.id}
			{sections}
			onJump={(index) => (props as DurableProps).onJumpToSection?.(entry!.id, index)}
		/>
	{/if}
	{#if isDurable}
		<!-- us5-actions: hover/focus-revealed row. Reserved h-6 keeps the strip in
		     flow at constant size, so reveal/hide never shifts message layout.
		     z-10 stays below the Highlighter selection pill and ContextMenu (z-50). -->
		<div
			class="message-actions pointer-events-none mt-0.5 flex h-6 items-center justify-end gap-0.5 self-end opacity-0 transition-opacity duration-150 z-10 group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none"
		>
			<Button
				variant="ghost"
				size="icon"
				class="size-6 rounded-md text-muted-foreground hover:text-foreground"
				title="Copy message"
				aria-label="Copy message"
				onclick={() => (props as DurableProps).onCopy(visible)}
			>
				<Copy class="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-6 rounded-md text-muted-foreground hover:text-foreground"
				title="Branch a new chat from this whole message"
				aria-label="Branch a new chat from this whole message"
				onclick={() => void (props as DurableProps).onBranchWhole(entry!.id)}
			>
				<GitBranch class="size-3.5" />
			</Button>
			{#if (props as DurableProps).onRegenerate && (props as DurableProps).canRegenerate}
				<Button
					variant="ghost"
					size="icon"
					class="size-6 rounded-md text-muted-foreground hover:text-foreground"
					title="Delete this reply and generate again"
					aria-label="Regenerate response"
					onclick={() => void (props as DurableProps).onRegenerate?.(entry!.id)}
				>
					<RotateCcw class="size-3.5" />
				</Button>
			{/if}
		</div>
	{/if}
	{#if interrupted && isDurable}
		<div class="mt-1 text-xs text-muted-foreground">This reply was interrupted.</div>
	{/if}
</div>

<ImageLightbox part={expanded} onClose={() => (expanded = null)} />

<style>
	/* us5-coarse-pointer: touch devices have no hover, so the action row stays
	   steadily visible. Doubled class out-specifies the opacity-0 utility. */
	@media (any-pointer: coarse) {
		.message-actions.message-actions {
			opacity: 1;
			pointer-events: auto;
		}
	}
</style>
