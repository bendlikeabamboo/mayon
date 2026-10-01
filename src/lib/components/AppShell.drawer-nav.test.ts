import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const shell = fs.readFileSync(path.resolve(__dirname, 'AppShell.svelte'), 'utf-8');
const sidebar = fs.readFileSync(path.resolve(__dirname, 'Sidebar.svelte'), 'utf-8');

describe('AppShell drawer nav', () => {
	it('renders the shared Sidebar inside the left drawer sheet', () => {
		expect(shell).toMatch(/<SheetContent[^>]*side="left"[\s\S]*?<Sidebar/);
	});

	it('closes the drawer when a nav link is clicked', () => {
		expect(shell).toMatch(/<Sidebar onNavigate=\{\(\) => \(drawerOpen = false\)\} \/>/);
	});

	it('drawer links get the Sidebar active-pill treatment', () => {
		expect(shell).toContain('<Sidebar');
		expect(sidebar).toMatch(/isActive\(item\.href\)/);
		expect(sidebar).toContain('bg-primary');
	});

	it('keeps nav and footer hit targets at least 40/36px tall', () => {
		expect(sidebar).toContain('py-2.5');
		expect(shell).not.toMatch(/py-2 text-sm font-medium/);
	});
});
