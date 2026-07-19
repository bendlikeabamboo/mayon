interface HastElement {
	type: 'element';
	tagName: string;
	properties: Record<string, unknown>;
	children: Array<HastElement | HastText>;
}

interface HastText {
	type: 'text';
	value: string;
	position?: {
		start: { offset: number; line: number; column: number };
		end: { offset: number; line: number; column: number };
	};
}

interface HastRoot {
	type: 'root';
	children: Array<HastElement | HastText>;
}

export const ADMONITION_TYPES = ['note', 'tip', 'warning', 'concept', 'info'] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];
export const admonitionTypes: ReadonlySet<string> = new Set(ADMONITION_TYPES);

const LABELS: Record<AdmonitionType, string> = {
	note: 'Note',
	tip: 'Tip',
	warning: 'Warning',
	concept: 'Concept',
	info: 'Info'
};

const ALERT_RE = /^\[!(\w+)\][ \t]*/i;

function isElement(node: unknown): node is HastElement {
	return !!node && typeof node === 'object' && (node as { type: string }).type === 'element';
}

function isRoot(node: unknown): node is HastRoot {
	return !!node && typeof node === 'object' && (node as { type: string }).type === 'root';
}

function transformBlockquote(bq: HastElement): boolean {
	if (!bq.children || bq.children.length === 0) return false;

	let firstElement: HastElement | undefined;
	for (const child of bq.children) {
		if (isElement(child)) {
			firstElement = child;
			break;
		}
	}
	if (!firstElement || firstElement.tagName !== 'p') return false;
	if (!firstElement.children || firstElement.children.length === 0) return false;

	const firstChild = firstElement.children[0];
	if (!firstChild || firstChild.type !== 'text') return false;

	const match = ALERT_RE.exec(firstChild.value);
	if (!match) return false;

	const rawType = match[1];
	const prefix = match[0];
	const type = rawType.toLowerCase();
	const known = admonitionTypes.has(type);

	const className = known ? [`callout`, `callout-${type}`] : [`callout`];
	const label = known
		? LABELS[type as AdmonitionType]
		: rawType[0].toUpperCase() + rawType.slice(1).toLowerCase();

	const bodyHead = firstChild.value.slice(prefix.length);

	bq.tagName = 'div';
	bq.properties.className = className;

	const titleNode: HastElement = {
		type: 'element',
		tagName: 'p',
		properties: { className: ['callout-title'] },
		children: [{ type: 'text', value: label }]
	};

	const bodyChildren: HastElement[] = [];

	if (bodyHead.length > 0 || firstElement.children.length > 1) {
		const firstParagraphChildren: (HastText | HastElement)[] = [];
		if (bodyHead.length > 0) {
			const origPos = firstChild.position;
			const bodyHeadNode: HastText = { type: 'text', value: bodyHead };
			if (origPos) {
				bodyHeadNode.position = {
					start: {
						offset: origPos.start.offset + prefix.length,
						line: origPos.start.line,
						column: origPos.start.column + prefix.length
					},
					end: {
						offset: origPos.end.offset,
						line: origPos.end.line,
						column: origPos.end.column
					}
				};
			}
			firstParagraphChildren.push(bodyHeadNode);
		}
		for (let i = 1; i < firstElement.children.length; i++) {
			firstParagraphChildren.push(firstElement.children[i] as HastText | HastElement);
		}
		if (firstParagraphChildren.length > 0) {
			bodyChildren.push({
				type: 'element',
				tagName: 'p',
				properties: {},
				children: firstParagraphChildren
			});
		}
	}

	for (let i = 1; i < bq.children.length; i++) {
		const child = bq.children[i];
		if (child === firstElement) continue;
		if (isElement(child)) {
			bodyChildren.push(child);
		}
	}

	bq.children = [titleNode, ...bodyChildren];
	return true;
}

function visitAll(node: unknown): void {
	if (isElement(node)) {
		if (node.tagName === 'blockquote') {
			transformBlockquote(node);
		}
		for (const child of node.children) {
			visitAll(child);
		}
	} else if (isRoot(node)) {
		for (const child of node.children) {
			visitAll(child);
		}
	}
}

export const admonition = () => (tree: HastRoot) => {
	visitAll(tree);
};
