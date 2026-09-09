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
import { themeState } from '$lib/stores/theme.svelte.js';

let mermaidPromise: Promise<Mermaid> | null = null;
let initializedTheme: 'light' | 'dark' | null = null;

/** True if a message's HTML contains a fenced mermaid block to render. */
export function hasMermaid(html: string): boolean {
	return /<code[^>]*class="[^"]*\blanguage-mermaid\b[^"]*"/.test(html);
}

/** Initialize mermaid once per theme (idempotent). Returns the configured API. */
async function getMermaid(theme: 'light' | 'dark'): Promise<Mermaid> {
	if (!mermaidPromise) {
		mermaidPromise = import('mermaid').then((mod) => mod.default);
	}
	const api = await mermaidPromise;
	if (initializedTheme !== theme) {
		initializedTheme = theme;
		// Re-calling initialize is the documented way to change mermaid config;
		// it must happen before subsequent render calls. Colors are baked into
		// the SVG at render time, so a theme change needs a re-initialize.
		api.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			theme: theme === 'dark' ? 'dark' : 'default'
		});
	}
	return api;
}

let renderSeq = 0;

// Module-wide chain: each initialize+render pair runs atomically, so an
// in-flight render can never straddle a theme re-initialize (initialize
// mutates mermaid's global config; renders read it lazily).
let renderChain: Promise<unknown> = Promise.resolve();

/**
 * Render a single mermaid source string to an SVG string, themed for the
 * resolved app theme at call time. Returns the theme the SVG was actually
 * rendered with so callers can stamp it. Rejects on parse error; the caller
 * decides whether to show a fallback or skip.
 */
export function renderMermaidBlock(
	source: string
): Promise<{ svg: string; theme: 'light' | 'dark' }> {
	const theme = themeState.resolved;
	const run = renderChain
		.catch(() => {})
		.then(async () => {
			const api = await getMermaid(theme);
			const id = `mmd-${Date.now()}-${renderSeq++}`;
			const { svg } = await api.render(id, source);
			return { svg, theme };
		});
	renderChain = run;
	return run;
}
