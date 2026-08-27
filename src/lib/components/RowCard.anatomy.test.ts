import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROWCARD = path.resolve(__dirname, 'RowCard.svelte');

describe('US8: RowCard anatomy', () => {
	const source = fs.readFileSync(ROWCARD, 'utf-8');

	it('composes the surface-card recipe', () => {
		expect(source).toContain('surface-card');
	});

	it('standardizes the hover tint idiom', () => {
		expect(source).toContain('transition-colors');
		expect(source).toContain('hover:bg-accent');
		expect(source).toContain('hover:text-accent-foreground');
	});

	it('uses the group/card named group scope', () => {
		expect(source).toContain('group/card');
	});

	it('renders as a link when href is given, else a static div', () => {
		expect(source).toContain('{#if href}');
		expect(source).toContain('<a');
		expect(source).toContain('data-rowcard="link"');
		expect(source).toContain('data-rowcard="static"');
		expect(source.indexOf('data-rowcard="link"')).toBeLessThan(source.indexOf('{:else}'));
	});

	it('pins the fixed anatomical slots in order: title · meta · badges', () => {
		const title = source.indexOf('data-rowcard-slot="title"');
		const meta = source.indexOf('data-rowcard-slot="meta"');
		const badges = source.indexOf('data-rowcard-slot="badges"');
		expect(title).toBeGreaterThan(-1);
		expect(meta).toBeGreaterThan(title);
		expect(badges).toBeGreaterThan(meta);
	});

	it('truncates the title and keeps the meta trailing + shrink-free line', () => {
		const frame = source.match(/\{#snippet frameContent\(\)\}[\s\S]*?\{\/snippet\}/);
		expect(frame, 'frameContent snippet not found').not.toBeNull();
		expect(frame![0]).toContain('truncate');
		expect(frame![0]).toContain('shrink-0 text-muted-foreground');
	});

	it('hover-reveals the trailing destructive action slot via the named group', () => {
		const action = source.indexOf('data-rowcard-slot="action"');
		expect(action).toBeGreaterThan(-1);
		expect(source).toContain('opacity-0');
		expect(source).toContain('group-hover/card:opacity-100');
		expect(source).toContain('group-hover/card:pointer-events-auto');
		expect(source).toContain('focus-within/card:opacity-100');
		expect(source).toContain('focus-within/card:pointer-events-auto');
	});

	it('keeps hidden actions inert until reveal', () => {
		expect(source).toContain('pointer-events-none');
	});

	it('compact prop sizes the home mini variant (reduced padding/typography)', () => {
		expect(source).toMatch(/compact\s*\?\s*'px-2\.5 py-1\.5'\s*:\s*'p-3'/);
		expect(source).toMatch(/compact \? 'text-\[11px\]' : 'text-xs'/);
	});

	it('focuses through focus-within accent ring on the card', () => {
		expect(source).toContain('outline-none');
		expect(source).toContain('focus-within:ring-2');
		expect(source).toContain('focus-within:ring-ring');
	});
});

describe('US8: RowCard adoption sites use the shared grammar', () => {
	const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf-8');

	it('chat list adopts RowCard with timestamp meta and delete action slot', () => {
		const source = read('../../routes/chat/+page.svelte');
		expect(source).toContain('<RowCard');
		expect(source).toContain('timeAgo(chat.updatedAt)');
		expect(source).toContain('{#snippet action()}');
		expect(source).not.toContain('group surface-card');
	});

	it('quiz list shows question-count progress badge in the badges prop', () => {
		const source = read('../../routes/quiz/+page.svelte');
		expect(source).toContain('badges={[`${quiz.questionCount} questions`]}');
		expect(source).not.toContain('group surface-card');
	});

	it('lab list adopts RowCard without hand-rolled card markup', () => {
		const source = read('../../routes/lab/+page.svelte');
		expect(source).toContain('<RowCard');
		expect(source).not.toContain('group surface-card');
	});

	it('home recents stacks adopt the compact variant only', () => {
		const source = read('../../routes/+page.svelte');
		expect(source.match(/<RowCard/g)?.length).toBe(3);
		expect(source.match(/compact/g)?.length).toBeGreaterThanOrEqual(3);
	});
});
