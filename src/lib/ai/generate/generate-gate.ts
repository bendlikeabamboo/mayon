import { z } from 'zod';
import { extractFencedBlock } from './fence';

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

export function extractGateBlock(raw: string): GateBlock | null {
	const jsonText = extractFencedBlock(raw, 'gate');
	if (jsonText === raw.trim()) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return null;
	}
	const result = GateBlockSchema.safeParse(parsed);
	return result.success ? result.data : null;
}

export function stripGateFence(raw: string): string {
	const idx = raw.indexOf('```gate');
	if (idx === -1) return raw;
	return raw.slice(0, idx).trimEnd();
}
