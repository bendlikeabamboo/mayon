/**
 * Customizable expound instructions (010-custom-expound-instructions).
 *
 * Owns the instruction-list entity, the five built-in defaults, read-time
 * sanitization, draft validation, and the settings-key accessors. The list is
 * stored whole under the `expoundInstructions` settings key (replace-on-write);
 * `name` (plus `description`) flows into expound prompts so each selected
 * format arrives as a concrete directive, while only `name` persists into
 * `branch_sources.add_formats`.
 */

export interface ExpoundInstruction {
	id: string;
	name: string;
	description?: string;
	builtin?: boolean;
}

export const DEFAULT_EXPOUND_INSTRUCTIONS: readonly ExpoundInstruction[] = Object.freeze([
	{ id: 'diagrams', name: 'Diagrams (prompt diagrams)', builtin: true },
	{ id: 'tables', name: 'Comparison Tables', builtin: true },
	{ id: 'code', name: 'Code Examples', builtin: true },
	{
		id: 'mermaid-diagram',
		name: 'Mermaid Diagram',
		description: 'Render flows and relationships as fenced Mermaid code blocks',
		builtin: true
	},
	{
		id: 'focus-callouts',
		name: 'Focus Callouts',
		description: 'Emphasize key takeaways with callout blocks',
		builtin: true
	}
]);

function defaultList(): ExpoundInstruction[] {
	return DEFAULT_EXPOUND_INSTRUCTIONS.map((i) => ({ ...i }));
}

/**
 * Validate a stored value element-wise; invalid elements are dropped. A
 * missing, corrupt, or empty value yields a copy of the defaults.
 */
export function sanitizeInstructions(raw: unknown): ExpoundInstruction[] {
	if (!Array.isArray(raw) || raw.length === 0) return defaultList();
	const out: ExpoundInstruction[] = [];
	for (const el of raw) {
		if (!el || typeof el !== 'object') continue;
		const e = el as Record<string, unknown>;
		if (typeof e.id !== 'string' || e.id.length === 0) continue;
		if (typeof e.name !== 'string' || e.name.trim().length === 0 || e.name.length > 60) continue;
		if (e.description !== undefined && typeof e.description !== 'string') continue;
		if (e.description !== undefined && e.description.length > 200) continue;
		if (e.builtin !== undefined && typeof e.builtin !== 'boolean') continue;
		const item: ExpoundInstruction = { id: e.id, name: e.name };
		if (typeof e.description === 'string' && e.description.trim().length > 0)
			item.description = e.description;
		if (e.builtin === true) item.builtin = true;
		out.push(item);
	}
	return out.length > 0 ? out : defaultList();
}

/**
 * Validate a draft entry against the current list. Returns a user-facing
 * error message, or null when the draft is valid. `ignoreId` excludes the
 * entry being edited from the duplicate-name check.
 */
export function validateInstruction(
	list: ExpoundInstruction[],
	draft: { name: string; description?: string },
	ignoreId?: string
): string | null {
	const name = draft.name.trim();
	if (name.length === 0) return 'Name is required.';
	if (name.length > 60) return 'Name must be 60 characters or fewer.';
	const dupe = list.some(
		(e) => e.id !== ignoreId && e.name.trim().toLowerCase() === name.toLowerCase()
	);
	if (dupe) return `An instruction named "${name}" already exists.`;
	const description = draft.description?.trim() ?? '';
	if (description.length > 200) return 'Description must be 200 characters or fewer.';
	return null;
}

/** Read the instruction list from settings, sanitized on read. */
export async function getExpoundInstructions(): Promise<ExpoundInstruction[]> {
	const { repos } = await import('$lib/db');
	return sanitizeInstructions(await repos.settings.get('expoundInstructions'));
}

/** Persist the whole instruction list (replace-on-write). */
export async function saveExpoundInstructions(list: ExpoundInstruction[]): Promise<void> {
	const { repos } = await import('$lib/db');
	await repos.settings.set('expoundInstructions', list);
}
