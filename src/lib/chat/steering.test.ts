import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { assembleContext } from './context';
import { projectEntries } from './projection';
import type { BranchArtifactMetadata } from './kinds';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

const ASK = 'write a function that adds two numbers';
const FLAWED = 'function add(a, b) {\n\treturn a - b; // flawed\n}';
const CORRECTED = 'function add(a, b) {\n\treturn a + b;\n}';
const BRANCH_TITLE = 'Fix the adder';

/** Raw-delta payload per data-model.md — excerpt + verbatim branch turns. */
function rawDelta(): string {
	return `[excerpt]\nHere you go:\n\n${FLAWED}\n[/excerpt]\n\n[user] fix it\n[assistant] Fixed:\n\n${CORRECTED}`;
}

function artifactMetadata(
	sourceChatId: string,
	branchPointMessageId: string
): BranchArtifactMetadata {
	return {
		mode: 'raw',
		sourceChatId,
		sourceChatTitle: BRANCH_TITLE,
		branchPointMessageId,
		anchor: 'recorded',
		summaryTraceId: null,
		regeneratedAt: null
	};
}

describe('branch back-propagation steers parent composition end-to-end (020 US2 / T017)', () => {
	it('a propagated artifact steers the parent context additively — stale flawed turn untouched (SC-001/SC-003)', async () => {
		// 1) Parent: flawed code exchange, then the conversation moves on.
		const parent = await repos.chats.createRoot({ title: 'Parent' });
		const _ask = await repos.messages.append(parent.id, 'user', ASK);
		const flawed = await repos.messages.append(parent.id, 'assistant', `Here you go:\n\n${FLAWED}`);
		const followup = await repos.messages.append(parent.id, 'user', 'now write tests');
		const before = await repos.messages.listByChat(parent.id);

		// 2) Branch the flawed reply; the fix happens only on the branch.
		const branch = await repos.chats.createChild({
			parentId: parent.id,
			branchPointMessageId: flawed.id,
			title: BRANCH_TITLE
		});
		await repos.messages.append(branch.id, 'user', 'fix it');
		await repos.messages.append(branch.id, 'assistant', `Fixed:\n\n${CORRECTED}`);

		// 3) Propagate: raw-delta artifact anchored into the parent between the
		// branch point and the next parent row (fractional midpoint ord).
		const payload = rawDelta();
		const artifact = await repos.messages.insertAnchored(
			parent.id,
			{
				role: 'user',
				content: payload,
				kind: 'branch_artifact',
				metadata: JSON.stringify(artifactMetadata(branch.id, flawed.id))
			},
			{ afterOrd: flawed.ord, beforeOrd: followup.ord }
		);
		expect(artifact.ord).toBe((flawed.ord + followup.ord) / 2);

		// SC-003: propagation is additive — every pre-existing parent row is
		// byte-identical, nothing rewritten, nothing deleted.
		const after = await repos.messages.listByChat(parent.id);
		expect(after).toHaveLength(before.length + 1);
		expect(after.filter((m) => m.id !== artifact.id)).toEqual(before);

		// 4) The parent's next composition carries the corrected state.
		const ctx = await assembleContext(parent.id);
		expect(ctx.map((m) => m.content)).toEqual([
			ASK,
			`Here you go:\n\n${FLAWED}`,
			payload,
			'now write tests'
		]);

		const projected: ModelMessage[] = projectEntries(ctx);
		// user(ask) → assistant(flawed) → user(artifact)+user(followup) merge.
		expect(projected).toHaveLength(3);

		const textAt = (i: number): string[] =>
			(projected[i].content as Array<{ type: string; text?: string }>)
				.filter((p) => p.type === 'text')
				.map((p) => p.text ?? '');

		// The artifact lands as a framed user message with the corrected state…
		expect(projected[2].role).toBe('user');
		const artifactText = textAt(2)[0];
		expect(artifactText.startsWith(`[Back-propagated from "${BRANCH_TITLE}" · raw · `)).toBe(true);
		expect(artifactText.endsWith(`\n\n${payload}`)).toBe(true);
		expect(artifactText).toContain(`[assistant] Fixed:\n\n${CORRECTED}`);
		// …merged with the adjacent follow-up user turn (consecutive-user merge).
		expect(textAt(2)[1]).toBe('now write tests');

		// Additive steering (SC-001): the stale flawed assistant turn is still
		// present, verbatim — nothing was rewritten in the projected history.
		expect(projected[1].role).toBe('assistant');
		expect(textAt(1)).toEqual([`Here you go:\n\n${FLAWED}`]);
	});
});
