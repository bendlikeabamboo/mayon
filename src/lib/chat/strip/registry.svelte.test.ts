// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Section } from '$lib/markdown/sections';
import {
	StripRegistry,
	getStripPrefFromContext,
	getStripRegistry,
	setStripContext,
	type StripAnchor,
	type StripContextValue
} from './registry.svelte';

const contextStore = vi.hoisted(() => {
	const contexts = new Map<symbol, unknown>();
	return {
		set: (key: symbol, value: unknown) => {
			contexts.set(key, value);
		},
		get: (key: symbol) => contexts.get(key),
		clear: () => contexts.clear()
	};
});

vi.mock('svelte', () => ({
	setContext: contextStore.set,
	getContext: contextStore.get
}));

const section = (index: number, excerpt = ''): Section => ({
	index,
	level: 2,
	title: `Section ${index}`,
	start: index * 10,
	end: (index + 1) * 10,
	length: 10,
	excerpt
});

const anchor = (msgId: string, count = 3, excerpt = ''): StripAnchor => ({
	msgId,
	el: document.createElement('div'),
	sections: Array.from({ length: count }, (_, i) => section(i, excerpt))
});

const msgIds = (registry: StripRegistry): string[] => registry.entries.map((e) => e.msgId);

beforeEach(() => {
	contextStore.clear();
});

describe('StripRegistry', () => {
	it('starts empty', () => {
		expect(new StripRegistry().entries).toEqual([]);
	});

	it('register appends entries in insertion order', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.register(anchor('b'));
		registry.register(anchor('c'));
		expect(msgIds(registry)).toEqual(['a', 'b', 'c']);
	});

	it('register upserts idempotently per msgId (replaces contents, no duplicate)', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.register(anchor('a', 5, 'renewed'));
		expect(msgIds(registry)).toEqual(['a']);
		expect(registry.entries[0].msgId).toBe('a');
		expect(registry.entries[0].sections).toHaveLength(5);
		expect(registry.entries[0].sections[0].excerpt).toBe('renewed');
	});

	it('upsert keeps the original insertion position', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.register(anchor('b'));
		registry.register(anchor('c'));
		registry.register(anchor('b', 7));
		expect(msgIds(registry)).toEqual(['a', 'b', 'c']);
		expect(registry.entries[1].sections).toHaveLength(7);
	});

	it('unregister removes the entry', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.register(anchor('b'));
		registry.unregister('a');
		expect(msgIds(registry)).toEqual(['b']);
	});

	it('unregister of an unknown msgId is a no-op', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.unregister('missing');
		expect(msgIds(registry)).toEqual(['a']);
	});

	it('bump keeps membership and contents but swaps the entry reference (recompute signal)', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.register(anchor('b'));
		const before = registry.entries[1];
		registry.bump('b');
		expect(msgIds(registry)).toEqual(['a', 'b']);
		expect(registry.entries[1]).not.toBe(before);
		expect(registry.entries[1].msgId).toBe('b');
		expect(registry.entries[1].el).toBe(before.el);
		expect(registry.entries[1].sections).toHaveLength(3);
	});

	it('bump of an unknown msgId is a no-op', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.bump('missing');
		expect(msgIds(registry)).toEqual(['a']);
	});

	it('preserves insertion order across unregister and re-register', () => {
		const registry = new StripRegistry();
		registry.register(anchor('a'));
		registry.register(anchor('b'));
		registry.register(anchor('c'));
		expect(msgIds(registry)).toEqual(['a', 'b', 'c']);
		registry.unregister('b');
		expect(msgIds(registry)).toEqual(['a', 'c']);
		registry.register(anchor('b'));
		expect(msgIds(registry)).toEqual(['a', 'c', 'b']);
	});

	// Regression guard: effects call register/unregister/bump (read-modify-write
	// in one tick) and the gutter reads entries from template blocks. A $state
	// array there made Svelte 5 throw state_unsafe_mutation and re-run those
	// effects against their own writes (main-thread flush storm). Mutations must
	// invalidate via the plain-written `version` counter instead.
	it('keeps the backing store non-reactive and invalidates via the version counter', async () => {
		const { readFileSync } = await import('node:fs');
		const path = await import('node:path');
		const source = readFileSync(path.resolve(__dirname, 'registry.svelte.ts'), 'utf8');
		expect(source).not.toMatch(/entries\s*=\s*\$state/);
		expect(source).toMatch(/version = \$state/);
		expect(source).not.toMatch(/this\.version\s*(\+\+|\+=|=\s*this\.version)/);
	});
});

describe('getStripRegistry', () => {
	it('returns null outside the chat page without throwing', () => {
		expect(() => getStripRegistry()).not.toThrow();
		expect(getStripRegistry()).toBeNull();
	});

	it('returns the registry provided via context', () => {
		const registry = new StripRegistry();
		setStripContext({ registry, stripEnabled: true });
		expect(getStripRegistry()).toBe(registry);
	});
});

describe('getStripPrefFromContext', () => {
	it('defaults to false when no context is set', () => {
		expect(getStripPrefFromContext()).toBe(false);
	});

	it('reads the strip-enabled flag through context', () => {
		setStripContext({ registry: new StripRegistry(), stripEnabled: true });
		expect(getStripPrefFromContext()).toBe(true);
		setStripContext({ registry: new StripRegistry(), stripEnabled: false });
		expect(getStripPrefFromContext()).toBe(false);
	});

	it('reads the flag at call time so a getter-backed provider stays live', () => {
		let flag = true;
		const value: StripContextValue = {
			registry: new StripRegistry(),
			get stripEnabled() {
				return flag;
			}
		};
		setStripContext(value);
		expect(getStripPrefFromContext()).toBe(true);
		flag = false;
		expect(getStripPrefFromContext()).toBe(false);
	});
});
