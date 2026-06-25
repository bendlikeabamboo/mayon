/**
 * Lab payload schema + parser (architecture.md §7, P3).
 *
 * Generation is prompt-driven (no per-adapter wire support for JSON mode): the
 * model is asked to emit a ```json fenced block whose content matches
 * {@link GeneratedLab}. This module owns the shape, the strict Zod schema, the
 * fenced-JSON extractor, the typed parse error, and the flattening into the
 * single-markdown-body + checklist shape the `labs` table stores.
 *
 * Kept provider-agnostic on purpose: every adapter delegates to the orchestrator
 * in `generate.ts`, which calls `parseGeneratedLab` here.
 */
import { z } from 'zod';
import { uuid } from '$lib/db/ids';
import type { LabChecklistItem } from '$lib/db/repositories/labs';
import { extractFencedJson } from './fence';

export { extractFencedJson } from './fence';

/**
 * The shape we ask the model to emit. `checklist` items carry only `{ text }`;
 * ids are assigned at persist time in {@link toLabContent} so the model never
 * has to produce stable ids.
 */
export interface GeneratedLab {
	title: string;
	intro: string;
	steps: string[];
	checklist: { text: string }[];
}

/** Strict Zod schema: rejects unknown keys so a chatty model can't smuggle
 *  fields past us. Reused by P4's quiz payload (different shape, same approach). */
/**
 * Accept a checklist item as either a bare string (what models naturally emit)
 * or `{"text": "..."}`. Coerces both to `{ text }`. A `z.preprocess` rather
 * than a union so the downstream type stays exactly `{ text: string }`.
 */
const ChecklistItemSchema = z.preprocess(
	(v) => (typeof v === 'string' ? { text: v } : v),
	z.object({ text: z.string().min(1) }).strict()
);

/** Strict Zod schema: rejects unknown keys so a chatty model can't smuggle
 *  fields past us. Checklist items accept both `"text"` and `{text}` (coerced).
 *  Reused by P4's quiz payload (different shape, same approach). */
export const GeneratedLabSchema: z.ZodType<GeneratedLab> = z
	.object({
		title: z.string().min(1),
		intro: z.string(),
		steps: z.array(z.string().min(1)),
		checklist: z.array(ChecklistItemSchema)
	})
	.strict();

/**
 * Internal error raised when the model output can't be turned into a
 * {@link GeneratedLab}. Not a transport error (it's not surfaced through
 * `formatProviderError`); the labs store inspects it to decide whether to offer
 * the "save raw anyway" affordance. Lives here (not in `errors.ts`) so the
 * provider layer stays unaware of generation internals.
 */
export class LabParseError extends Error {
	constructor(
		message: string,
		public readonly raw: string
	) {
		super(message);
		this.name = 'LabParseError';
	}
}

/**
 * Parse model output into a {@link GeneratedLab}. Throws {@link LabParseError}
 * (carrying the raw text) on any failure — JSON syntax error, schema mismatch,
 * or extra/missing fields.
 */
export function parseGeneratedLab(raw: string): GeneratedLab {
	const jsonText = extractFencedJson(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		throw new LabParseError(
			`Model output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			raw
		);
	}
	const result = GeneratedLabSchema.safeParse(parsed);
	if (!result.success) {
		// Join the issues into a single readable line; the first issue is usually
		// the actionable one.
		const first = result.error.issues[0];
		const path = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
		const msg = first ? `${first.message}${path}` : 'schema validation failed';
		throw new LabParseError(`Model output did not match the lab schema: ${msg}`, raw);
	}
	return result.data;
}

/**
 * Flatten a {@link GeneratedLab} into the storage shape the `labs` table uses:
 * a single markdown `content` body (title + intro + numbered steps) and a
 * checklist with stable ids assigned here (the model only emits `{ text }`).
 */
export function toLabContent(lab: GeneratedLab): {
	title: string;
	content: string;
	checklist: LabChecklistItem[];
} {
	const stepsBlock =
		lab.steps.length > 0
			? `\n\n## Steps\n\n${lab.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
			: '';
	const content = `# ${lab.title}\n\n${lab.intro}${stepsBlock}`;
	const checklist: LabChecklistItem[] = lab.checklist.map((item) => ({
		id: uuid(),
		text: item.text,
		done: false
	}));
	return { title: lab.title, content, checklist };
}
