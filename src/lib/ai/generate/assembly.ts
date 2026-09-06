/**
 * Prompt assembly shared by the quiz and lab generation orchestrators
 * (specs/020-rc-ui-verification, prompt-settings-contract.md).
 *
 * The contract is code-owned and always comes first, byte-identical to the
 * shipped constant. Custom instructions are user-authored free text appended
 * AFTER the contract in a trailing `# Custom instructions` block — never
 * prepended, never interposed, never replacing any contract byte.
 */
export const CUSTOM_INSTRUCTIONS_HEADING = '# Custom instructions';

/**
 * Effective system prompt = CONTRACT + (instructions ? "\n\n# Custom instructions\n" + instructions : "").
 * Blank/whitespace-only instructions count as absent (contract-only).
 */
export function assemblePrompt(contract: string, instructions?: string | null): string {
	if (!instructions || instructions.trim().length === 0) return contract;
	return `${contract}\n\n${CUSTOM_INSTRUCTIONS_HEADING}\n${instructions}`;
}

/**
 * Read the custom-instructions value for one generation surface, performing
 * the one-time idempotent legacy migration (whole-prompt override →
 * instructions key; see specs/020-rc-ui-verification/contracts/
 * prompt-settings-contract.md). Shared by readQuizPrompt and readLabPrompt so
 * the migration semantics cannot drift between the two surfaces.
 *
 * Returns the trimmed non-empty instructions string, or null when the surface
 * is contract-only. Migration runs only when the instructions key is ABSENT;
 * if both keys exist the new key wins and the legacy row is left untouched.
 */
export async function readCustomInstructions(
	instructionsKey: string,
	legacyKey: string
): Promise<string | null> {
	const { repos } = await import('$lib/db');
	const instructions = await repos.settings.get<string>(instructionsKey);
	if (instructions !== null && instructions.trim().length > 0) return instructions.trim();
	// Legacy migration: only when the instructions key is absent. If both keys
	// exist, prefer the new key and leave the legacy row untouched (no churn).
	// Old contract text embedded in migrated instructions is inert: the
	// contract always comes from code, first and unmodified.
	if (instructions === null) {
		const legacy = await repos.settings.get<string>(legacyKey);
		if (legacy !== null && legacy.trim().length > 0) {
			await repos.settings.set(instructionsKey, legacy);
			await repos.settings.delete(legacyKey);
			return legacy.trim();
		}
	}
	return null;
}
