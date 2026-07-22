<script lang="ts">
	import { onMount } from 'svelte';
	import { renderMarkdown, renderMarkdownLive } from '$lib/markdown/render';
	import { incRender } from '$lib/perf/mark';
	import { hasMermaid, renderMermaidBlock } from '$lib/markdown/mermaid';
	import { isExternalLink } from '$lib/markdown/links';
	import { enhanceFocusable } from '$lib/markdown/focusable';
	import MermaidPreview from './MermaidPreview.svelte';
	import FocusModal from './FocusModal.svelte';

	/**
	 * Renders sanitized markdown via `{@html}`. When the rendered HTML contains
	 * fenced mermaid blocks, each is lazily rendered to SVG and swapped in
	 * client-side after mount. Each message is its own component instance so
	 * Mermaid only loads for messages that actually need it.
	 */
	let {
		raw,
		class: className = '',
		live = false
	}: { raw: string; class?: string; live?: boolean } = $props();

	const html = $derived(live ? renderMarkdownLive(raw) : renderMarkdown(raw));
	const needsMermaid = $derived(hasMermaid(html));

	let container = $state<HTMLDivElement | null>(null);
	let previewSvg = $state<string | null>(null);
	let focusNode = $state<HTMLElement | null>(null);
	let focusTitle = $state('Table');

	onMount(() => {
		if (live || !needsMermaid || !container) return;

		const scheduleIdle =
			typeof requestIdleCallback === 'function'
				? requestIdleCallback
				: (cb: () => void) => setTimeout(cb, 0) as unknown as number;

		const blocks = Array.from(container.querySelectorAll('code.language-mermaid'));
		for (const code of blocks) {
			const source = code.textContent ?? '';
			const pre = code.parentElement;

			const placeholder = document.createElement('div');
			placeholder.className = 'mermaid-pending';
			placeholder.innerHTML =
				'<div class="mermaid-pending-bar"></div><span>Generating Diagram\u2026</span>';
			pre?.replaceWith(placeholder);

			scheduleIdle(() => {
				void renderMermaidBlock(source)
					.then((svg) => {
						const wrapper = document.createElement('div');
						wrapper.className =
							'mermaid-svg my-3 flex justify-center overflow-x-auto cursor-zoom-in';
						wrapper.title = 'Click to preview';
						wrapper.innerHTML = svg;
						wrapper.addEventListener('click', () => {
							previewSvg = wrapper.innerHTML;
						});
						placeholder.replaceWith(wrapper);
					})
					.catch((err) => {
						const note = document.createElement('p');
						note.className = 'my-3 text-xs text-red-600 dark:text-red-400';
						note.textContent = `Mermaid render failed: ${err instanceof Error ? err.message : String(err)}`;
						placeholder.replaceWith(note);
					});
			});
		}
	});

	$effect(() => {
		incRender('Markdown');
		const rendered = html;
		if (!container || !rendered || live) return;
		const links = container.querySelectorAll<HTMLAnchorElement>('a[href]');
		for (const link of links) {
			const href = link.getAttribute('href') ?? '';
			if (!isExternalLink(href)) continue;
			link.classList.add('external-link');
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noopener noreferrer');
			if (!link.querySelector('svg.external-link-icon')) {
				const icon = document.createElement('span');
				icon.className = 'external-link-icon inline-block ml-0.5 align-text-bottom opacity-70';
				icon.innerHTML =
					'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
				link.appendChild(icon);
			}
		}
		enhanceFocusable(container, 'table', (n) => {
			focusNode = n;
			focusTitle = 'Table';
		});
		const pres = container.querySelectorAll<HTMLPreElement>('pre');
		for (const pre of pres) {
			if (pre.querySelector('.md-copy-btn')) continue;
			const code = pre.querySelector<HTMLElement>('code');
			if (code?.classList.contains('language-mermaid')) continue;
			const btn = document.createElement('button');
			btn.className = 'md-copy-btn';
			btn.textContent = 'Copy';
			btn.addEventListener('click', () => {
				const text = pre.textContent ?? '';
				void navigator.clipboard?.writeText(text);
				btn.textContent = 'Copied';
				setTimeout(() => {
					btn.textContent = 'Copy';
				}, 1500);
			});
			pre.appendChild(btn);
		}
	});
</script>

<div bind:this={container} class="markdown-body {className}">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by rehype-sanitize (allowlist in render.ts); mermaid SVG injected post-hoc on wrapper elements -->
	{@html html}
</div>

{#if previewSvg}
	<MermaidPreview
		open={previewSvg !== null}
		svgHtml={previewSvg}
		onClose={() => {
			previewSvg = null;
		}}
	/>
{/if}

<FocusModal
	open={focusNode !== null}
	title={focusTitle}
	node={focusNode}
	onClose={() => {
		focusNode = null;
	}}
/>

<style>
	:global(.markdown-body) {
		font-family: var(--font-serif);
		font-size: 0.9375rem;
		font-weight: 400;
		line-height: 1.65;
		word-wrap: break-word;
		overflow-wrap: anywhere;
		overflow-x: hidden;
		max-width: 100%;
		-webkit-font-smoothing: auto;
		-moz-osx-font-smoothing: auto;
	}
	:global(.markdown-body p) {
		margin: 0.5em 0;
	}
	:global(.markdown-body h1),
	:global(.markdown-body h2),
	:global(.markdown-body h3),
	:global(.markdown-body h4) {
		font-weight: 600;
		margin: 1em 0 0.4em;
		line-height: 1.3;
	}
	:global(.markdown-body h1) {
		font-size: 1.4em;
	}
	:global(.markdown-body h2) {
		font-size: 1.25em;
	}
	:global(.markdown-body h3) {
		font-size: 1.1em;
	}
	:global(.markdown-body ul),
	:global(.markdown-body ol) {
		margin: 0.5em 0;
		padding-left: 1.5em;
	}
	:global(.markdown-body li) {
		margin: 0.2em 0;
	}
	:global(.markdown-body a) {
		color: oklch(0.55 0.2 250);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.markdown-body a.external-link) {
		color: var(--muted-foreground);
	}
	:global(.markdown-body blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 1em;
		margin: 0.5em 0;
		color: var(--muted-foreground);
	}
	:global(.markdown-body :not(pre) > code) {
		background: var(--muted);
		padding: 0.15em 0.35em;
		border-radius: 0.25rem;
		font-size: 0.85em;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	:global(.markdown-body pre) {
		position: relative;
		background: var(--muted);
		padding: 0.75em 1em;
		border-radius: 0.5rem;
		overflow-x: auto;
		max-width: 100%;
		margin: 0.5em 0;
	}
	:global(.markdown-body pre code) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.825em;
		background: transparent;
		padding: 0;
	}
	:global(.markdown-body table) {
		border-collapse: collapse;
		display: block;
		width: max-content;
		min-width: 100%;
		margin: 0.5em 0;
		font-size: 0.85em;
	}
	:global(.markdown-body th),
	:global(.markdown-body td) {
		border: 1px solid var(--border);
		padding: 0.4em 0.6em;
		text-align: left;
		max-width: 24rem;
		overflow-wrap: break-word;
		word-wrap: break-word;
		hyphens: auto;
	}
	:global(.markdown-body hr) {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 1em 0;
	}
	:global(.markdown-body .callout) {
		border-left: 3px solid var(--callout-info);
		padding: 0.5em 0.75em;
		margin: 1.25em 0;
		border-radius: var(--radius-sm);
		background: color-mix(in oklch, var(--callout-info) 12%, var(--card));
	}
	:global(.markdown-body .callout.callout-warning) {
		border-left-color: var(--callout-warn);
		background: color-mix(in oklch, var(--callout-warn) 12%, var(--card));
	}
	:global(.markdown-body .callout.callout-concept) {
		border-left-color: var(--callout-concept);
		background: color-mix(in oklch, var(--callout-concept) 12%, var(--card));
	}
	:global(.markdown-body .callout-title) {
		font-weight: 600;
		font-size: 0.9em;
		margin: 0 0 0.25em;
		color: var(--callout-info);
	}
	:global(.markdown-body .callout.callout-warning .callout-title) {
		color: var(--callout-warn);
	}
	:global(.markdown-body .callout.callout-concept .callout-title) {
		color: var(--callout-concept);
	}
	:global(.markdown-body pre:hover .md-copy-btn) {
		opacity: 1;
	}
	:global(.md-copy-btn) {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s;
		padding: 0.2em 0.5em;
		border-radius: 0.25rem;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--muted-foreground);
		font-size: 0.75em;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		cursor: pointer;
		line-height: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.md-copy-btn) {
			transition: none;
		}
	}
	:global(.md-copy-btn:hover) {
		color: var(--foreground);
		border-color: var(--foreground);
	}
	:global(.md-focusable) {
		border-radius: 0.375rem;
		margin: 0.5em 0;
		border: 1px solid transparent;
	}
	:global(.md-focusable:hover) {
		border-color: var(--border);
	}
	:global(.md-focusable-btn) {
		position: sticky;
		top: 0;
		left: 0;
		float: left;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		margin: 0.25rem;
		border-radius: 0.25rem;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--muted-foreground);
		opacity: 0.6;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.md-focusable-btn) {
			transition: none;
		}
	}
	:global(.md-focusable-btn:hover) {
		opacity: 1;
		color: var(--foreground);
	}
	.mermaid-pending {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		color: var(--color-muted-foreground);
		font-size: 0.875rem;
	}
	.mermaid-pending-bar {
		width: 1ch;
		height: 1em;
		background: currentColor;
		border-radius: 1px;
		animation: mermaid-bar-spin 0.8s linear infinite;
	}
	@keyframes mermaid-bar-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
