import { z } from 'zod';

export const GateBlockSchema: z.ZodType<GateBlock> = z
	.object({
		nextUnit: z.string(),
		options: z.array(z.string()),
		progress: z.string()
	})
	.strict();

export interface GateBlock {
	nextUnit: string;
	options: string[];
	progress: string;
}

const GATE_FENCE_RE = /```\s*(?:gate|json)\s*\n?/i;

export function extractGateBlock(raw: string): GateBlock | null {
	const gateFence = extractFencedBlock(raw, 'gate');
	if (gateFence !== raw.trim()) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(gateFence);
		} catch {
			return null;
		}
		const result = GateBlockSchema.safeParse(parsed);
		if (result.success) return result.data;
	}

	const jsonFenceMatch = raw.match(GATE_FENCE_RE);
	if (jsonFenceMatch && jsonFenceMatch.index !== undefined) {
		const content = extractFencedBlockAt(raw, jsonFenceMatch.index);
		if (content !== null && isGateShaped(content)) {
			const result = GateBlockSchema.safeParse(JSON.parse(content));
			if (result.success) return result.data;
		}
	}

	const fallback = extractTrailingGateJson(raw);
	if (!fallback) return null;

	const result = GateBlockSchema.safeParse(fallback);
	return result.success ? result.data : null;
}

const TRAILING_GATE_RE = /\n\{[\s\S]*"nextUnit"[\s\S]*"options"[\s\S]*"progress"[\s\S]*\}\s*$/;

function extractTrailingGateJson(raw: string): unknown {
	const match = raw.match(TRAILING_GATE_RE);
	if (!match) return null;
	try {
		return JSON.parse(match[0]);
	} catch {
		return null;
	}
}

export function stripGateFence(raw: string): string {
	const gateOpen = raw.match(/```\s*gate\b/i);
	if (gateOpen && gateOpen.index !== undefined) {
		return raw.slice(0, gateOpen.index).trimEnd();
	}
	const jsonFenceMatch = raw.match(GATE_FENCE_RE);
	if (jsonFenceMatch && jsonFenceMatch.index !== undefined) {
		const content = extractFencedBlockAt(raw, jsonFenceMatch.index);
		if (content !== null && isGateShaped(content)) {
			return raw.slice(0, jsonFenceMatch.index).trimEnd();
		}
	}
	const fallbackIdx = raw.search(TRAILING_GATE_RE);
	if (fallbackIdx !== -1) {
		return raw.slice(0, fallbackIdx).trimEnd();
	}
	return raw;
}

function extractFencedBlockAt(raw: string, fenceIndex: number): string | null {
	const trimmed = raw.trim();
	const openMatch = trimmed.slice(fenceIndex).match(GATE_FENCE_RE);
	if (!openMatch) return null;
	const start = fenceIndex + openMatch[0].length;
	const tail = trimmed.slice(start);
	const closeIdx = tail.lastIndexOf('```');
	if (closeIdx <= 0) return null;
	return tail.slice(0, closeIdx).trim();
}

function isGateShaped(json: string): boolean {
	try {
		const parsed = JSON.parse(json);
		return (
			typeof parsed === 'object' &&
			parsed !== null &&
			'nextUnit' in parsed &&
			'options' in parsed &&
			'progress' in parsed
		);
	} catch {
		return false;
	}
}

export function extractFencedBlock(raw: string, tag?: string): string {
	const trimmed = raw.trim();

	let openRegex: RegExp;
	if (tag === 'gate') {
		openRegex = /```\s*gate\s*\n?/i;
	} else {
		openRegex = /```(?:json)?\s*\n?/i;
	}

	const open = trimmed.match(openRegex);
	if (!open || open.index === undefined) return trimmed;
	const start = open.index + open[0].length;

	const closeIdx = trimmed.lastIndexOf('```');
	if (closeIdx <= start) {
		return trimmed.slice(start).trim();
	}
	return trimmed.slice(start, closeIdx).trim();
}

export function extractFencedJson(raw: string): string {
	return extractFencedBlock(raw, 'json');
}

export function findGateFromMessages<
	T extends { role: string; toolName?: string | null; metadata?: string | null }
>(messages: readonly T[]): GateBlock | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === 'user') break;
		if (m.role === 'assistant' && m.toolName === 'present_choices' && m.metadata) {
			try {
				const result = GateBlockSchema.safeParse(JSON.parse(m.metadata));
				if (result.success) return result.data;
			} catch {
				/* ignore malformed */
			}
		}
	}
	return null;
}
