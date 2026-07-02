const MAXIMIZE2_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

export interface EnhanceFocusableOptions {
	maxHeight?: string;
	buttonLabel?: string;
}

export function enhanceFocusable(
	container: ParentNode,
	selector: string,
	onExpand: (node: HTMLElement, label: string) => void,
	opts?: EnhanceFocusableOptions
): void {
	const maxHeight = opts?.maxHeight ?? '50vh';
	const buttonLabel = opts?.buttonLabel ?? 'Expand';

	const nodes = container.querySelectorAll<HTMLElement>(selector);
	for (const node of nodes) {
		if (node.parentElement?.closest('[data-focusable]')) continue;

		const wrapper = document.createElement('div');
		wrapper.className = 'md-focusable';
		wrapper.setAttribute('data-focusable', '');
		wrapper.style.position = 'relative';
		wrapper.style.overflow = 'auto';
		wrapper.style.maxHeight = maxHeight;
		wrapper.style.width = '100%';

		const btn = document.createElement('button');
		btn.type = 'button';
		btn.setAttribute('aria-label', buttonLabel);
		btn.className = 'md-focusable-btn';
		btn.innerHTML = MAXIMIZE2_SVG;
		btn.addEventListener('click', () => {
			onExpand(node, buttonLabel);
		});

		wrapper.appendChild(btn);
		node.parentElement?.insertBefore(wrapper, node);
		wrapper.appendChild(node);
	}
}
