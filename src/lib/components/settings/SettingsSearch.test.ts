import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const searchSource = fs.readFileSync(path.resolve(__dirname, 'SettingsSearch.svelte'), 'utf-8');
const pageSource = fs.readFileSync(
	path.resolve(__dirname, '../../../routes/settings/+page.svelte'),
	'utf-8'
);
const providerSource = fs.readFileSync(
	path.resolve(__dirname, '../ai/ProviderConfig.svelte'),
	'utf-8'
);
const appShellSource = fs.readFileSync(path.resolve(__dirname, '../AppShell.svelte'), 'utf-8');

describe('SettingsSearch source contract', () => {
	it('disables cmdk filtering in favor of matchSections', () => {
		expect(searchSource).toContain('shouldFilter={false}');
		expect(searchSource).toMatch(
			/import \{[^}]*matchSections[^}]*\} from '\$lib\/settings\/sections'/
		);
		expect(searchSource).toMatch(/matchSections\(query, sections\)/);
	});

	it('shows the contracted empty text', () => {
		expect(searchSource).toContain('No matching section');
	});

	it('exposes a focus() binding for the cmd-K handler', () => {
		expect(searchSource).toMatch(/export function focus\(\)/);
	});

	it('labels the input for assistive tech', () => {
		expect(searchSource).toMatch(/<Command\.Input[^>]*aria-label=/s);
	});

	it('renders inline, not as a dialog', () => {
		expect(searchSource).not.toContain('Command.Dialog');
	});
});

describe('settings page keyboard contract', () => {
	it('intercepts cmd-K in the capture phase at the window', () => {
		expect(pageSource).toMatch(/<svelte:window[^>]*onkeydowncapture=/s);
	});

	it('handles Cmd/Ctrl-K with preventDefault, stopPropagation, and focus', () => {
		expect(pageSource).toMatch(/\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === 'k'/);
		const handler = pageSource.match(/function handleGlobalKeydown[\s\S]*?\n\t\}/)?.[0] ?? '';
		expect(handler).toContain('preventDefault()');
		expect(handler).toContain('stopPropagation()');
		expect(handler).toContain('searchRef?.focus()');
	});

	it('does not hijack other keys', () => {
		expect(pageSource).not.toMatch(/key === '\/'/);
	});

	it('mounts SettingsSearch through the ProviderConfig header snippet', () => {
		const snippet = pageSource.match(/\{#snippet header\(\)\}[\s\S]*?\{\/snippet\}/)?.[0] ?? '';
		expect(snippet).toContain('<SettingsSearch');
		expect(snippet).toMatch(/sections=\{sections\}|\{sections\}/);
		expect(snippet).toMatch(/onJump=\{jumpToSection\}/);
		expect(snippet).toContain('bind:this={searchRef}');
	});
});

describe('ProviderConfig header slot contract', () => {
	it('accepts an optional header snippet', () => {
		expect(providerSource).toMatch(/header\?: Snippet/);
	});

	it('renders the header between the intro and the Providers section', () => {
		const renderAt = providerSource.indexOf('{@render header?.()}');
		const introAt = providerSource.indexOf('never in the local settings store');
		const providersAt = providerSource.indexOf('id="providers"');
		expect(renderAt).toBeGreaterThan(-1);
		expect(renderAt).toBeGreaterThan(introAt);
		expect(renderAt).toBeLessThan(providersAt);
	});
});

describe('AppShell regression guard', () => {
	it('keeps the global cmd-K and "/" /search bindings untouched', () => {
		expect(appShellSource).toMatch(/e\.key === '\/' \|\| \(e\.key === 'k'/);
		expect(appShellSource).toContain("goto('/search')");
	});
});
