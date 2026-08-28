import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const railSource = fs.readFileSync(path.resolve(__dirname, 'SettingsRail.svelte'), 'utf-8');
const pageSource = fs.readFileSync(
	path.resolve(__dirname, '../../../routes/settings/+page.svelte'),
	'utf-8'
);
const providerSource = fs.readFileSync(
	path.resolve(__dirname, '../ai/ProviderConfig.svelte'),
	'utf-8'
);

describe('SettingsRail source contract', () => {
	it('renders a nav landmark labelled "Settings sections"', () => {
		expect(railSource).toMatch(/<nav[^>]*aria-label="Settings sections"/);
	});

	it('highlights the active entry via aria-current bound to the active state', () => {
		expect(railSource).toMatch(/aria-current=\{active \? 'true' : undefined\}/);
		expect(railSource).toContain('activeId');
	});

	it('renders entries in sections prop order', () => {
		expect(railSource).toMatch(/\{#each sections as entry/);
	});

	it('renders entries as buttons', () => {
		expect(railSource).toContain('type="button"');
	});

	it('delegates jumping via the onJump prop with no internal scroll or history logic', () => {
		expect(railSource).toMatch(/onJump/);
		expect(railSource).not.toContain('scrollIntoView');
		expect(railSource).not.toContain('window.history');
		expect(railSource).not.toContain('pushState');
		expect(railSource).not.toContain('replaceState');
	});

	it('is hidden below the xl breakpoint', () => {
		expect(railSource).toMatch(/class="[^"]*\bhidden[^"]*\bxl:block"/);
		expect(railSource).not.toContain('lg:block');
	});
});

describe('settings page orchestration source contract', () => {
	it('drives activeId from createScrollSpy', () => {
		expect(pageSource).toMatch(/createScrollSpy\(/);
	});

	it('creates exactly one history entry per explicit jump via pushJump', () => {
		expect(pageSource).toMatch(/hashSync\.pushJump\(/);
	});

	it('replaces the hash on scroll-spy at-rest changes via replaceActive', () => {
		expect(pageSource).toMatch(/hashSync\.replaceActive\(/);
	});

	it('scrolls with a reduced-motion conditional behavior', () => {
		expect(pageSource).toContain('scrollIntoView');
		expect(pageSource).toContain('prefers-reduced-motion');
		expect(pageSource).toMatch(/behavior: reduced \? 'auto' : 'smooth'/);
	});

	it('applies the section-flash arrival emphasis', () => {
		expect(pageSource).toContain('section-flash');
	});

	it('centers the column within a page-level rail zone reserved at xl', () => {
		expect(pageSource).toMatch(/xl:pr-52/);
		expect(providerSource).not.toContain('xl:mr-48');
	});

	it('caps and centers the content unit so the rail tracks the column at a constant gap', () => {
		expect(pageSource).toMatch(/max-w-\[64rem\]/);
		expect(pageSource).toMatch(/absolute inset-y-0 right-6 hidden w-44 xl:block/);
	});

	it('guards the rail against short viewports with a max-height scroll', () => {
		expect(railSource).toMatch(/max-h-\[calc\(100dvh-3rem\)\]/);
		expect(railSource).toMatch(/overflow-y-auto/);
	});
});
