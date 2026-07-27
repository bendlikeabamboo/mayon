import { describe, expect, it } from 'vitest';
import { planRestore, LEGACY_VERSION } from '@mayon/shared';
import type { SchemaMigrationDescriptor } from '@mayon/shared';

describe('planRestore', () => {
	it('proceeds when versions are equal with no migrations', () => {
		const plan = planRestore(1, 1, []);
		expect(plan.decision).toBe('proceed');
		expect(plan.migrations).toHaveLength(0);
		expect(plan.dumpVersion).toBe(1);
		expect(plan.currentVersion).toBe(1);
	});

	it('proceeds from legacy version with legacy notice', () => {
		const plan = planRestore(LEGACY_VERSION, 1, []);
		expect(plan.decision).toBe('proceed');
		expect(plan.migrations).toHaveLength(0);
		expect(plan.notice).toContain('legacy');
		expect(plan.dumpVersion).toBe(0);
		expect(plan.currentVersion).toBe(1);
	});

	it('proceeds with additive gap, no migrate needed', () => {
		const registry: SchemaMigrationDescriptor[] = [
			{ from: 0, to: 1, description: 'add col', kind: 'additive' }
		];
		const plan = planRestore(0, 1, registry);
		expect(plan.decision).toBe('proceed');
		expect(plan.migrations).toHaveLength(1);
		expect(plan.migrations[0].kind).toBe('additive');
	});

	it('proceeds with breaking gap that has migrate', () => {
		const registry: SchemaMigrationDescriptor[] = [
			{ from: 0, to: 1, description: 'rename col', kind: 'breaking', hasMigrate: true }
		];
		const plan = planRestore(0, 1, registry);
		expect(plan.decision).toBe('proceed');
		expect(plan.migrations).toHaveLength(1);
		expect(plan.migrations[0].kind).toBe('breaking');
		expect(plan.migrations[0].hasMigrate).toBe(true);
	});

	it('refuses breaking gap without migrate', () => {
		const registry: SchemaMigrationDescriptor[] = [
			{ from: 0, to: 1, description: 'rename col', kind: 'breaking', hasMigrate: false }
		];
		const plan = planRestore(0, 1, registry);
		expect(plan.decision).toBe('refuse-breaking');
		expect(plan.migrations).toHaveLength(0);
		expect(plan.notice).toContain('upgrade Mayon');
	});

	it('refuses newer dump version', () => {
		const plan = planRestore(2, 1, []);
		expect(plan.decision).toBe('refuse-newer');
		expect(plan.migrations).toHaveLength(0);
		expect(plan.notice).toContain('newer');
	});

	it('multi-hop 0→3 with additive, breaking+migrate, additive', () => {
		const registry: SchemaMigrationDescriptor[] = [
			{ from: 0, to: 1, description: 'add col a', kind: 'additive' },
			{ from: 1, to: 2, description: 'rename col b', kind: 'breaking', hasMigrate: true },
			{ from: 2, to: 3, description: 'add col c', kind: 'additive' }
		];
		const plan = planRestore(0, 3, registry);
		expect(plan.decision).toBe('proceed');
		expect(plan.migrations).toHaveLength(3);
		expect(plan.migrations.map((m) => m.to)).toEqual([1, 2, 3]);
		expect(plan.migrations[1].kind).toBe('breaking');
	});

	it('multi-hop refuses if any breaking has no migrate', () => {
		const registry: SchemaMigrationDescriptor[] = [
			{ from: 0, to: 1, description: 'add col a', kind: 'additive' },
			{ from: 1, to: 2, description: 'rename col b', kind: 'breaking', hasMigrate: false },
			{ from: 2, to: 3, description: 'add col c', kind: 'additive' }
		];
		const plan = planRestore(0, 3, registry);
		expect(plan.decision).toBe('refuse-breaking');
	});

	it('only selects migrations in [dumpVersion, currentVersion) range', () => {
		const registry: SchemaMigrationDescriptor[] = [
			{ from: 0, to: 1, description: 'old', kind: 'additive' },
			{ from: 1, to: 2, description: 'target', kind: 'additive' },
			{ from: 2, to: 3, description: 'future', kind: 'additive' }
		];
		const plan = planRestore(1, 2, registry);
		expect(plan.decision).toBe('proceed');
		expect(plan.migrations).toHaveLength(1);
		expect(plan.migrations[0].from).toBe(1);
		expect(plan.migrations[0].to).toBe(2);
	});
});
