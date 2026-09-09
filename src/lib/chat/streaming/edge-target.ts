export type EdgeEffect = 'normal' | 'soften' | 'suppressed' | 'hidden';

export interface EdgeTarget {
	rect: DOMRect | null;
	effect: EdgeEffect;
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, pre, ul, ol, table, blockquote, div, li';

// jsdom has no client-rect geometry; browsers always resolve via Range.
function zeroRect(): DOMRect {
	return {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		width: 0,
		height: 0,
		x: 0,
		y: 0
	} as DOMRect;
}

function trailingRect(block: HTMLElement): DOMRect | null {
	const doc = block.ownerDocument;
	let last: Text | null = null;
	// NodeFilter.SHOW_TEXT; literal avoids jsdom's missing window globals
	const walker = doc.createTreeWalker(block, 4);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		if (text.textContent?.trim()) last = text;
	}
	if (!last) return null;
	try {
		const range = doc.createRange();
		range.selectNodeContents(last);
		// Growth edge = the tail of the trailing text, not the whole node.
		range.setStart(last, Math.max(0, last.length - 80));
		const rect = range.getBoundingClientRect();
		if (rect && Number.isFinite(rect.top) && Number.isFinite(rect.left)) return rect;
	} catch {
		// no geometry (jsdom)
	}
	return zeroRect();
}

/**
 * Locate the growth edge of a rendered markdown container: the trailing text
 * of the last block that carries visible text. Pure DOM in/out — no Svelte.
 */
export function resolveEdgeTarget(container: HTMLElement): EdgeTarget {
	const blocks = container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		if (!block.textContent?.trim()) continue;
		if (block.closest('pre') || block.closest('table')) {
			return { rect: null, effect: 'suppressed' };
		}
		if (block.closest('li')) {
			return { rect: trailingRect(block), effect: 'soften' };
		}
		return { rect: trailingRect(block), effect: 'normal' };
	}
	return { rect: null, effect: 'hidden' };
}
