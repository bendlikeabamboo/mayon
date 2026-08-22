import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
