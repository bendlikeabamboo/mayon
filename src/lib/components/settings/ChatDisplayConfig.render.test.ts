import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, 'ChatDisplayConfig.svelte'), 'utf-8');

describe('ChatDisplayConfig streaming-look select source contract', () => {
	it('renders a labeled native select', () => {
		expect(source).toContain('<select');
		const label = source.match(/<label[^>]*for="([^"]+)"/);
		expect(label, 'label not found').not.toBeNull();
		const selectId = source.match(/<select[^>]*id="([^"]+)"/);
		expect(selectId, 'select id not found').not.toBeNull();
		expect(label![1]).toBe(selectId![1]);
	});

	it('binds the select over STREAM_PRESET_OPTIONS with STREAM_PRESET_LABELS', () => {
		expect(source).toContain('STREAM_PRESET_OPTIONS');
		expect(source).toContain('STREAM_PRESET_LABELS');
		expect(source).toMatch(/<select[^>]*bind:value=\{/);
	});

	it('optimistically saves via setStreamPreset and reverts on error', () => {
		expect(source).toContain('await setStreamPreset(next)');
		expect(source).toMatch(/catch[\s\S]{0,200}(streamPreset|preset)\s*=\s*prev/);
	});

	it('loads the current preset on mount', () => {
		expect(source).toContain('await getStreamPreset()');
	});

	it('maps each preset to its behavior in helper text', () => {
		expect(source).toContain('Calm');
		expect(source).toContain('Standard');
		expect(source).toContain('Expressive');
	});
});
