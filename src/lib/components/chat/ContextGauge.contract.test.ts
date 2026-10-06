import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const composer = fs.readFileSync(path.resolve(__dirname, 'Composer.svelte'), 'utf-8');
const gauge = fs.readFileSync(path.resolve(__dirname, 'ContextGauge.svelte'), 'utf-8');
const page = fs.readFileSync(
	path.resolve(__dirname, '../../../routes/chat/[id]/+page.svelte'),
	'utf-8'
);
const contentStart = gauge.indexOf('<PopoverContent');
const content = gauge.slice(contentStart, gauge.indexOf('</PopoverContent>', contentStart));

describe('ContextGauge wiring (023 US1)', () => {
	it('mounts the gauge in the Composer status row, after the provider·model label', () => {
		expect(composer).toContain('<ContextGauge');
		const labelAt = composer.indexOf('{providerName} · {modelId}');
		const mountAt = composer.indexOf('<ContextGauge');
		expect(labelAt).toBeGreaterThan(-1);
		expect(mountAt).toBeGreaterThan(labelAt);
	});

	it('ContextGauge renders nothing when gauge is null and carries state/provenance', () => {
		expect(gauge).toContain('{#if gauge}');
		expect(gauge).toContain('data-state={gauge.state}');
		expect(gauge).toContain('data-provenance={gauge.provenance}');
	});

	it('route derives the gauge and passes it into Composer', () => {
		expect(page).toContain('deriveContextGauge');
		expect(page).toContain('gauge={contextGauge}');
	});

	it('Composer stays presentational: no store import or derivation for the gauge', () => {
		expect(composer).not.toContain('$lib/stores');
		expect(composer).not.toContain('deriveContextGauge');
	});
});

describe('ContextGauge escalation (023 US3)', () => {
	it('low state gets the amber tone, critical gets text-destructive', () => {
		expect(gauge).toContain("gauge.state === 'low'");
		expect(gauge).toContain('text-amber-600 dark:text-amber-400');
		expect(gauge).toContain("gauge.state === 'critical'");
		expect(gauge).toContain('text-destructive');
	});

	it('critical surfaces guidance via .tip + data-tip and is announced with role=status', () => {
		expect(gauge).toContain('class:tip={critical}');
		expect(gauge).toContain('Context nearly full — start a new chat or branch to free context');
		expect(gauge).toContain("role={critical ? 'status' : undefined}");
	});

	it('tip composes with the provenance title', () => {
		expect(gauge).toContain("(critical ? ` — ${guidance}` : '')");
	});
});

describe('ContextGauge detail popover (023 US4)', () => {
	it('wraps the gauge in the repo popover parts', () => {
		expect(gauge).toContain("from '$lib/components/ui/popover/index.js'");
		expect(gauge).toContain('<Popover>');
		expect(gauge).toContain('<PopoverTrigger');
		expect(gauge).toContain('<PopoverContent');
	});

	it('trigger wraps the gauge span with an aria-label', () => {
		expect(gauge).toContain('aria-label="Context usage details"');
		const triggerAt = gauge.indexOf('<PopoverTrigger');
		const spanAt = gauge.indexOf('<span', triggerAt);
		const closeAt = gauge.indexOf('</PopoverTrigger>', triggerAt);
		expect(spanAt).toBeGreaterThan(triggerAt);
		expect(closeAt).toBeGreaterThan(spanAt);
	});

	it('popover content carries the contract rows', () => {
		expect(content).toContain('Used');
		expect(content).toContain('Window');
		expect(content).toContain('History + instructions');
		expect(content).toContain('Latest reply');
	});

	it('breakdown rows render only from the anchor usage triple', () => {
		expect(gauge).toContain('gauge?.anchorUsage?.promptTokens != null');
		expect(gauge).toContain('gauge.anchorUsage?.completionTokens != null');
	});

	it('content shows the est. marking on the Used row', () => {
		expect(content).toContain("marked ? ' est.' : ''");
	});

	it('limitSource is humanized', () => {
		expect(gauge).toContain('declared on provider card');
		expect(gauge).toContain('model catalog');
		expect(gauge).toContain("'unknown'");
	});

	it('no-limit popover points at declaring a window regardless of provenance', () => {
		expect(gauge).toContain('unknown — set "Context window" on the provider card');
	});

	it('content shows provenance and the anchor model with mismatch note', () => {
		expect(gauge).toContain('estimated from context size');
		expect(gauge).toContain("'reported usage'");
		expect(content).toContain('model: ${gauge.anchorModelId}');
		expect(content).toContain('differs from active model');
	});
});
