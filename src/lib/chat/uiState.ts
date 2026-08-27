/**
 * Per-chat UI display preferences persisted through the settings KV store
 * (`repos.settings.get/set`, JSON values) — no schema migration.
 *
 * Key convention (`specs/012-ui-visual-articulation/contracts/settings-keys.md`):
 * `ui-state:<chatId>:<facet>`. This module is the SOLE authorized writer of
 * `ui-state:*` keys; components read only via these helpers.
 *
 * Reads are defensive (contract rule 3): a missing key, corrupt JSON, or a
 * wrong-typed value falls back to the documented default without throwing.
 * The settings repo itself returns null on miss/parse-failure; wrong types are
 * filtered here. Orphaned keys after chat deletion are acceptable (matches the
 * `'draft:<chatId>'` precedent — no cascade cleanup).
 */
import { repos } from '$lib/db';
import { DEFAULT_TITLE } from '$lib/ai/generate/generate-title';

/** Facet suffix for the consolidated header summary chip's detail panel. */
const BRIEF_EXPANDED_FACET = ':briefExpanded';

/** Literal composition of the documented key: `ui-state:<chatId>:briefExpanded`. */
export function briefExpandedKey(chatId: string): string {
	return 'ui-state:' + chatId + BRIEF_EXPANDED_FACET;
}

/**
 * Absent-key default resolution: an untitled/new chat (null, empty, or the
 * `DEFAULT_TITLE` placeholder) ⇒ expanded; a titled chat ⇒ collapsed.
 */
export function defaultBriefExpanded(chatTitle: string | null | undefined): boolean {
	const title = (chatTitle ?? '').trim();
	return title.length === 0 || title === DEFAULT_TITLE;
}

/**
 * Whether the summary chip's inline detail panel should be expanded for this
 * chat. A stored boolean always wins over the default (rule: stored value wins
 * whenever present); anything else resolves the title-based default.
 */
export async function isBriefExpanded(chatId: string, chatTitle: string | null): Promise<boolean> {
	let stored: unknown;
	try {
		stored = await repos.settings.get(briefExpandedKey(chatId));
	} catch {
		return defaultBriefExpanded(chatTitle);
	}
	return typeof stored === 'boolean' ? stored : defaultBriefExpanded(chatTitle);
}

/** Persist the chip expansion state for this chat. Sole writer of the key. */
export async function setBriefExpanded(chatId: string, expanded: boolean): Promise<void> {
	await repos.settings.set(briefExpandedKey(chatId), expanded);
}
