import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, matchSections, visibleSections } from './sections';

describe('SETTINGS_SECTIONS registry', () => {
	it('holds the 9 sections in frozen page order', () => {
		expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
			'providers',
			'mcp',
			'chat',
			'learner-profile',
			'expound-instructions',
			'lab-prompt',
			'quiz-prompt',
			'security',
			'data',
			'sandbox-db'
		]);
	});

	it('has unique ids', () => {
		const ids = SETTINGS_SECTIONS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('labels mirror the rendered h2 headings verbatim', () => {
		expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
			'Providers',
			'MCP Servers',
			'Chat',
			'Learner profile',
			'Expound Instructions',
			'Lab generation prompt',
			'Quiz generation prompt',
			'Security',
			'Data',
			'Sandbox DB'
		]);
	});

	it('aliases are lowercase and unique within each entry', () => {
		for (const section of SETTINGS_SECTIONS) {
			expect(new Set(section.aliases).size).toBe(section.aliases.length);
			for (const alias of section.aliases) {
				expect(alias).toBe(alias.toLowerCase());
			}
		}
	});

	it('gates only sandbox-db behind a capability', () => {
		const gated = SETTINGS_SECTIONS.filter((s) => s.cap !== null);
		expect(gated.map((s) => s.id)).toEqual(['sandbox-db']);
		expect(gated[0]?.cap).toBe('sandbox-db');
	});
});

describe('visibleSections', () => {
	it('keeps every section when the sandbox-db cap is advertised', () => {
		expect(visibleSections(SETTINGS_SECTIONS, ['sandbox-db'])).toEqual([...SETTINGS_SECTIONS]);
	});

	it('drops only sandbox-db when the cap is absent from caps', () => {
		const visible = visibleSections(SETTINGS_SECTIONS, ['stdio-mcp', 'pg']);
		expect(visible.map((s) => s.id)).toEqual([
			'providers',
			'mcp',
			'chat',
			'learner-profile',
			'expound-instructions',
			'lab-prompt',
			'quiz-prompt',
			'security',
			'data'
		]);
	});
});

describe('matchSections', () => {
	it('matches backup and restore aliases to data', () => {
		expect(matchSections('backup', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['data']);
		expect(matchSections('restore', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['data']);
		expect(matchSections('Backup', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['data']);
	});

	it('matches the sandbox alias to sandbox-db', () => {
		expect(matchSections('sandbox', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['sandbox-db']);
	});

	it('matches the security aliases to security', () => {
		expect(matchSections('mfa', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['security']);
		expect(matchSections('Lock', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['security']);
	});

	it('matches prompt to both prompt sections in registry order', () => {
		expect(matchSections('prompt', SETTINGS_SECTIONS).map((s) => s.id)).toEqual([
			'lab-prompt',
			'quiz-prompt'
		]);
	});

	it('returns all sections for blank and whitespace queries', () => {
		expect(matchSections('', SETTINGS_SECTIONS)).toEqual([...SETTINGS_SECTIONS]);
		expect(matchSections('   ', SETTINGS_SECTIONS)).toEqual([...SETTINGS_SECTIONS]);
	});

	it('returns nothing when no section matches', () => {
		expect(matchSections('zzzz', SETTINGS_SECTIONS)).toEqual([]);
	});

	it('ANDs query tokens within a single section', () => {
		expect(matchSections('data backup', SETTINGS_SECTIONS).map((s) => s.id)).toEqual(['data']);
		expect(matchSections('backup sandbox', SETTINGS_SECTIONS)).toEqual([]);
	});
});
