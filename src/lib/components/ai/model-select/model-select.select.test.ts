import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatContextWindow } from './format-context-window.svelte';

const ITEM_SRC = path.resolve(__dirname, 'model-select-item.svelte');
const SELECT_SRC = path.resolve(__dirname, 'model-select.svelte');
const BITS_UI_TYPES = path.resolve(
	process.cwd(),
	'node_modules/bits-ui/dist/bits/command/types.d.ts'
);

const itemSource = fs.readFileSync(ITEM_SRC, 'utf-8');
const selectSource = fs.readFileSync(SELECT_SRC, 'utf-8');
const bitsUiTypes = fs.readFileSync(BITS_UI_TYPES, 'utf-8');

describe('model-select-item prop wiring', () => {
	it('bits-ui Command.Item expects onSelect (camelCase)', () => {
		expect(bitsUiTypes).toMatch(/onSelect\?\s*:\s*\(\)\s*=>\s*void/);
	});

	it('model-select-item maps onselect → onSelect for Command.Item', () => {
		expect(itemSource).toContain('onselect');
		expect(itemSource).toMatch(/onSelect=\{onselect\}/);
		expect(itemSource).not.toMatch(/<Command\.Item[^>]*\bonselect=/);
	});

	it('model-select passes onselect (lowercase) as the public API', () => {
		expect(selectSource).toContain('onselect?: (model: string) => void');
		expect(selectSource).toMatch(/<ModelSelectItem[^>]*onselect=/);
	});

	it('onselect is destructured out of restProps (not spread to bits-ui)', () => {
		const scriptSection = itemSource.split('</script>')[0];
		expect(scriptSection).toContain('onselect,');
	});
});

describe('model-select context window hint', () => {
	it('contextWindows is an optional prop', () => {
		expect(selectSource).toContain('contextWindows?: Record<string, number>');
	});

	it('hint is guarded by the {#if} — rendered only for models present in contextWindows', () => {
		expect(selectSource).toMatch(
			/\{#if contextWindows\?\.\[model\] !== undefined\}[\s\S]*?contextWindows\[model\][\s\S]*?\{\/if\}/
		);
	});

	it('hint renders beside ModelSelectName in the muted secondary idiom', () => {
		expect(selectSource).toMatch(
			/<ModelSelectName>\{model\}<\/ModelSelectName>\s*\{#if contextWindows/
		);
		expect(selectSource).toContain('text-[11px] text-muted-foreground');
	});

	it('hint carries the exact token count in the title attribute', () => {
		expect(selectSource).toMatch(/title="\{contextWindows\[model\]\} tokens"/);
	});

	it('component stays presentational (no fetching, no store imports)', () => {
		const scriptSection = selectSource.split('</script>')[0];
		expect(scriptSection).not.toContain('fetch(');
		expect(scriptSection).not.toMatch(/from '\$app\//);
		expect(scriptSection).not.toMatch(/from '\$lib\/stores/);
		expect(scriptSection).not.toContain('onMount');
	});
});

describe('formatContextWindow', () => {
	it('128000 → 128K', () => {
		expect(formatContextWindow(128_000)).toBe('128K');
	});

	it('1000000 → 1M', () => {
		expect(formatContextWindow(1_000_000)).toBe('1M');
	});

	it('1500000 → 1.5M', () => {
		expect(formatContextWindow(1_500_000)).toBe('1.5M');
	});

	it('999 → 999 (raw below 1K)', () => {
		expect(formatContextWindow(999)).toBe('999');
	});
});
