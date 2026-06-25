/**
 * Lazy Mermaid rendering (architecture.md §4, P2 risks/notes).
 *
 * Mermaid is large (~600KB min). It is imported dynamically, **per message**,
 * only when that message's rendered HTML contains a `language-mermaid` code
 * block. This keeps the main bundle slim.
 *
 * Flow:
 *   1. `renderMarkdown` leaves fenced ```mermaid blocks as
 *      `<pre><code class="language-mermaid">SOURCE</code></pre>`.
 *   2. The `<Markdown>` component scans its container for those blocks.
 *   3. For each, it calls `renderMermaidBlock(source)` → SVG, then swaps the
 *      `<pre>` for the SVG.
 *
 * Trust model: mermaid's own SVG output is treated as trusted (it is generated
 * by mermaid's own code, not arbitrary HTML). The mermaid source itself came
 * through `rehype-sanitize` as escaped text content (it was a fenced code
 * block, not raw HTML), so it cannot contain unescaped markup by the time it
 * reaches mermaid. The resulting SVG is injected via `{@html}` on a dedicated
 * wrapper element, never mixed back into the sanitized prose tree.
 */
import type { Mermaid } from 'mermaid';

let mermaidPromise: Promise<Mermaid> | null = null;

/** True if a message's HTML contains a fenced mermaid block to render. */
export function hasMermaid(html: string): boolean {
	return /<code[^>]*class="[^"]*\blanguage-mermaid\b[^"]*"/.test(html);
}

/** Initialize mermaid once (idempotent). Returns the configured API. */
async function getMermaid(): Promise<Mermaid> {
	if (!mermaidPromise) {
		mermaidPromise = (async () => {
			const mod = await import('mermaid');
			const api = mod.default;
			// startOnReady must be false under a framework: we render imperatively.
			api.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: 'default'
			});
			return api;
		})();
	}
	return mermaidPromise;
}

let renderSeq = 0;

/**
 * Render a single mermaid source string to an SVG string. Throws on parse
 * error; the caller decides whether to show a fallback or skip.
 */
export async function renderMermaidBlock(source: string): Promise<string> {
	const api = await getMermaid();
	const id = `mmd-${Date.now()}-${renderSeq++}`;
	const { svg } = await api.render(id, source);
	return svg;
}
