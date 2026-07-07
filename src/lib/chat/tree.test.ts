import { describe, expect, it } from 'vitest';
import { breadcrumbToRoot, buildSubtreeModel } from './tree';
import type { Chat } from '$lib/db/schema';

function mkChat(opts: Partial<Chat> & { id: string }): Chat {
	return {
		id: opts.id,
		parentId: opts.parentId ?? null,
		rootId: opts.rootId ?? opts.id,
		branchPointMessageId: opts.branchPointMessageId ?? null,
		title: opts.title ?? opts.id,
		depth: opts.depth ?? 0,
		provider: opts.provider ?? null,
		model: opts.model ?? null,
		brief: opts.brief ?? null,
		mcpConfig: opts.mcpConfig ?? null,
		createdAt: opts.createdAt ?? 0,
		updatedAt: opts.updatedAt ?? 0
	};
}

describe('breadcrumbToRoot', () => {
	it('returns just the node when it is the root', () => {
		const root = mkChat({ id: 'r' });
		const byId = new Map([['r', root]]);
		expect(breadcrumbToRoot(root, byId).map((c) => c.id)).toEqual(['r']);
	});

	it('walks parents up to the root in root…current order', () => {
		const root = mkChat({ id: 'r' });
		const mid = mkChat({ id: 'm', parentId: 'r', rootId: 'r', depth: 1 });
		const leaf = mkChat({ id: 'l', parentId: 'm', rootId: 'r', depth: 2 });
		const byId = new Map([
			['r', root],
			['m', mid],
			['l', leaf]
		]);
		expect(breadcrumbToRoot(leaf, byId).map((c) => c.id)).toEqual(['r', 'm', 'l']);
	});

	it('stops at a missing parent without throwing', () => {
		const orphan = mkChat({ id: 'o', parentId: 'ghost', rootId: 'r' });
		const byId = new Map([['o', orphan]]);
		expect(breadcrumbToRoot(orphan, byId).map((c) => c.id)).toEqual(['o']);
	});

	it('breaks a cycle safely', () => {
		const a = mkChat({ id: 'a', parentId: 'b' });
		const b = mkChat({ id: 'b', parentId: 'a' });
		const byId = new Map([
			['a', a],
			['b', b]
		]);
		const chain = breadcrumbToRoot(a, byId).map((c) => c.id);
		// Should include a then b once, then stop (no infinite loop).
		expect(chain).toEqual(['b', 'a']);
	});
});

describe('buildSubtreeModel', () => {
	it('builds a single-root tree with nested children', () => {
		const root = mkChat({ id: 'r', createdAt: 0 });
		const c1 = mkChat({ id: 'c1', parentId: 'r', rootId: 'r', depth: 1, createdAt: 10 });
		const c2 = mkChat({ id: 'c2', parentId: 'r', rootId: 'r', depth: 1, createdAt: 20 });
		const g = mkChat({ id: 'g', parentId: 'c1', rootId: 'r', depth: 2, createdAt: 30 });
		const flat = [root, c1, c2, g];

		const forest = buildSubtreeModel(flat);
		expect(forest.map((n) => n.chat.id)).toEqual(['r']);
		const r = forest[0];
		expect(r.children.map((n) => n.chat.id)).toEqual(['c1', 'c2']);
		expect(r.children[0].children.map((n) => n.chat.id)).toEqual(['g']);
	});

	it('returns multiple roots when the flat list spans more than one root', () => {
		const r1 = mkChat({ id: 'r1', createdAt: 0 });
		const r2 = mkChat({ id: 'r2', createdAt: 5 });
		const forest = buildSubtreeModel([r1, r2]);
		expect(forest.map((n) => n.chat.id)).toEqual(['r1', 'r2']);
	});

	it('sorts children by createdAt for stable display', () => {
		const root = mkChat({ id: 'r', createdAt: 0 });
		// Inserted out of order; expect sorted ascending.
		const late = mkChat({ id: 'late', parentId: 'r', rootId: 'r', createdAt: 100 });
		const early = mkChat({ id: 'early', parentId: 'r', rootId: 'r', createdAt: 1 });
		const forest = buildSubtreeModel([root, late, early]);
		expect(forest[0].children.map((n) => n.chat.id)).toEqual(['early', 'late']);
	});
});
