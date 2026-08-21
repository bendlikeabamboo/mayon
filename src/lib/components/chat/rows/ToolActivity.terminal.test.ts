import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TOOL_ACTIVITY = path.resolve(__dirname, 'ToolActivity.svelte');

describe('US4: ToolActivity terminal presentation (registry-driven)', () => {
	const source = fs.readFileSync(TOOL_ACTIVITY, 'utf-8');

	it('imports terminal classification from the tool registry', () => {
		expect(
			source.match(
				/import\s*\{[^}]*getToolDefinition[^}]*\}\s*from\s*['"]\$lib\/agent\/registry['"]/
			)
		).not.toBeNull();
	});

	it('derives terminality via getToolDefinition(...)?.terminal', () => {
		expect(source).toMatch(/getToolDefinition\([^)]*\)\?\.terminal/);
	});

	it('contains no UI-side tool-name list (present_choices must not appear)', () => {
		expect(source).not.toContain('present_choices');
	});

	it('terminal status maps to neutral Circle glyph', () => {
		expect(source).toMatch(/status\(\) === 'terminal'/);
	});

	it('unpaired non-terminal calls keep the failure mark (XCircle branch remains)', () => {
		expect(source).toContain('XCircle');
	});
});
