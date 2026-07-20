import type { AlignmentTable } from '$lib/chat/selection';

export interface WrapAttrs {
	'data-branch-chat': string;
}

export type WrapResult =
	| { ok: true; wrapped: number }
	| { ok: false; reason: 'empty' | 'unaligned' };

export function wrapRange(
	table: AlignmentTable,
	startCanonical: number,
	endCanonical: number,
	attrs: WrapAttrs
): WrapResult {
	if (startCanonical < 0 || endCanonical <= startCanonical) {
		return { ok: false, reason: 'empty' };
	}

	let wrapped = 0;

	for (const entry of table.entries) {
		if (entry.excluded) continue;
		if (entry.canonicalEnd <= startCanonical || entry.canonicalStart >= endCanonical) continue;

		const localStart = Math.max(0, startCanonical - entry.canonicalStart);
		const localEnd = Math.min(entry.canonicalEnd, endCanonical) - entry.canonicalStart;

		let target: Text = entry.node;

		if (localStart > 0) {
			try {
				target = target.splitText(localStart);
			} catch {
				if (import.meta.env.DEV) console.warn('[expound] splitText failed at localStart');
				continue;
			}
		}

		const wrapLen = localEnd - localStart;
		if (wrapLen < target.textContent!.length) {
			try {
				target.splitText(wrapLen);
			} catch {
				if (import.meta.env.DEV) console.warn('[expound] splitText failed at wrapLen');
				continue;
			}
		}

		const span = entry.node.ownerDocument!.createElement('span');
		span.className = 'expound-mark';
		for (const [k, v] of Object.entries(attrs)) {
			span.setAttribute(k, v);
		}

		target.parentNode?.replaceChild(span, target);
		span.appendChild(target);
		wrapped++;
	}

	if (wrapped === 0) {
		return { ok: false, reason: 'unaligned' };
	}

	return { ok: true, wrapped };
}
