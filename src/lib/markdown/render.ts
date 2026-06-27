/**
 * Markdown → sanitized HTML pipeline (architecture.md §4, P2).
 *
 * Pipeline order (remark = mdast, rehype = hast):
 *   remark-parse → remark-gfm → remark-math
 *   → (remark-rehype bridge, built into unified)
 *   → rehype-katex → rehype-highlight → rehype-sanitize → rehype-stringify
 *
 * Mermaid is deliberately **not** part of this pipeline. The published
 * `remark-mermaid` renders via a headless browser (mermaid.cli/puppeteer),
 * which cannot run in a browser SPA bundle. Instead, fenced `mermaid` code
 * blocks survive sanitization as `<pre><code class="language-mermaid">…</code></pre>`
 * and the `<Markdown>` component swaps them for rendered SVG client-side via
 * `mermaid.ts` (lazy `import('mermaid')` per message).
 *
 * `renderMarkdown` is pure (no DOM) so it is unit-testable.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';
import rehypeStringify from 'rehype-stringify';
import { admonition } from './admonition';

/**
 * Sanitize schema: GitHub-default, extended to keep the classes the pipeline
 * itself emits (highlight.js `hljs`/language classes, KaTeX output classes,
 * and `language-mermaid` so the component can find mermaid blocks post-render).
 *
 * We must allow `className` broadly because rehype-highlight tags `<code>` and
 * `<span>` elements with language names, and KaTeX emits classed spans
 * everywhere. The default GitHub schema already permits a curated `class`
 * allowlist per tag; we widen it to accept any class on inline/code elements so
 * highlighter + math output is not stripped.
 */
const sanitizeSchema: Schema = {
	...defaultSchema,
	attributes: {
		...defaultSchema.attributes,
		code: [
			...(defaultSchema.attributes?.code ?? []),
			// highlight.js: `hljs` + `language-xxx`; mermaid marker: `language-mermaid`
			['className', 'hljs', /^language-./]
		],
		span: [
			...(defaultSchema.attributes?.span ?? []),
			// highlight.js token spans + KaTeX spans both use arbitrary class names.
			['className', /^.*$/]
		],
		div: [
			...(defaultSchema.attributes?.div ?? []),
			// KaTeX block containers + admonition callouts (LS2).
			['className', /^katex$/, /^katex-display$/, /^callout$/, /^callout-./]
		],
		p: [['className', /^callout-title$/]]
	},
	tagNames: [...(defaultSchema.tagNames ?? []), 'math', 'semantics', 'annotation']
} satisfies Schema;

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkMath)
	.use(remarkRehype)
	.use(rehypeKatex)
	.use(rehypeHighlight)
	.use(admonition)
	.use(rehypeSanitize, sanitizeSchema)
	.use(rehypeStringify);

/**
 * Render raw markdown into sanitized HTML string. Mermaid fenced blocks are
 * left as `<pre><code class="language-mermaid">` for the component to render.
 */
export function renderMarkdown(raw: string): string {
	return String(processor.processSync(raw));
}

/** Exposed for tests / component reuse. */
export { sanitizeSchema };
