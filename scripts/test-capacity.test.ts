import { describe, expect, it } from 'vitest';

import { GIB, TestCapacityError, formatCapacityReport, resolveCapacity } from './test-capacity.mjs';

const CAPABLE = { logicalCpus: 8, hostMemoryBytes: 8 * GIB };

describe('resolveCapacity', () => {
	it('reports capable at the 8 CPU / 8 GiB threshold with gate-derived workers', () => {
		const capacity = resolveCapacity({ ...CAPABLE });

		expect(capacity).toMatchObject({
			mode: 'capable',
			logicalCpus: 8,
			usableMemoryBytes: 8 * GIB,
			override: 'auto',
			workers: 4,
			fileParallelism: true,
			fullyParallel: true,
			reason: 'thresholds-met'
		});
	});

	it('caps capable workers at the explicit MAX_WORKERS value', () => {
		expect(resolveCapacity({ ...CAPABLE, maxWorkers: 3 }).workers).toBe(3);
		expect(resolveCapacity({ ...CAPABLE, maxWorkers: 12 }).workers).toBe(4);
	});

	it('treats fewer than 8 CPUs as low-spec and serial', () => {
		const capacity = resolveCapacity({ logicalCpus: 4, hostMemoryBytes: 16 * GIB });

		expect(capacity).toMatchObject({
			mode: 'low-spec',
			workers: 1,
			fileParallelism: false,
			fullyParallel: false,
			reason: 'cpus-below-8'
		});
	});

	it('treats less than 8 GiB as low-spec and serial', () => {
		const capacity = resolveCapacity({ logicalCpus: 16, hostMemoryBytes: 8 * GIB - 1 });

		expect(capacity).toMatchObject({
			mode: 'low-spec',
			workers: 1,
			reason: 'memory-below-8GiB'
		});
	});

	it('reports both thresholds when both are low', () => {
		expect(resolveCapacity({ logicalCpus: 2, hostMemoryBytes: 2 * GIB }).reason).toBe(
			'cpus-and-memory-below-8'
		);
	});

	it('lets a cgroup CPU quota override a capable host reading', () => {
		const capacity = resolveCapacity({
			logicalCpus: 16,
			hostMemoryBytes: 16 * GIB,
			cgroupCpus: 4
		});

		expect(capacity).toMatchObject({
			mode: 'low-spec',
			logicalCpus: 4,
			reason: 'cpus-below-8',
			workers: 1
		});
	});

	it('lets a cgroup memory cap override a capable host reading', () => {
		const capacity = resolveCapacity({
			logicalCpus: 16,
			hostMemoryBytes: 16 * GIB,
			cgroupMemoryBytes: 4 * GIB
		});

		expect(capacity).toMatchObject({
			mode: 'low-spec',
			usableMemoryBytes: 4 * GIB,
			reason: 'memory-below-8GiB',
			workers: 1
		});
	});

	it('uses the tighter of memory.max and memory.high', () => {
		const capacity = resolveCapacity({
			logicalCpus: 16,
			hostMemoryBytes: 16 * GIB,
			cgroupMemoryBytes: 12 * GIB,
			cgroupMemoryHighBytes: 6 * GIB
		});

		expect(capacity.usableMemoryBytes).toBe(6 * GIB);
		expect(capacity.mode).toBe('low-spec');
	});

	it('reports unknown when no readings are available', () => {
		const capacity = resolveCapacity({});

		expect(capacity).toMatchObject({
			mode: 'unknown',
			logicalCpus: null,
			usableMemoryBytes: null,
			workers: 1,
			fileParallelism: false,
			fullyParallel: false,
			reason: 'readings-unknown'
		});
	});

	it('reports the missing half of an incomplete reading as unknown', () => {
		expect(resolveCapacity({ logicalCpus: 16 }).reason).toBe('memory-unknown');
		expect(resolveCapacity({ hostMemoryBytes: 16 * GIB }).reason).toBe('cpus-unknown');
	});

	it('forces serial with override off even on a capable host', () => {
		const capacity = resolveCapacity({ ...CAPABLE, override: 'off' });

		expect(capacity).toMatchObject({
			mode: 'low-spec',
			override: 'off',
			workers: 1,
			fileParallelism: false,
			reason: 'override-off'
		});
	});

	it("rejects override 'on' without MAYON_TEST_MAX_WORKERS as exit-code 2", () => {
		let error;
		try {
			resolveCapacity({ ...CAPABLE, override: 'on' });
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(TestCapacityError);
		expect(error.exitCode).toBe(2);
		expect(error.message).toBe("override 'on' requires MAYON_TEST_MAX_WORKERS");
	});

	it("honors override 'on' with an explicit worker count below the threshold", () => {
		const capacity = resolveCapacity({
			logicalCpus: 2,
			hostMemoryBytes: 2 * GIB,
			override: 'on',
			maxWorkers: 6
		});

		expect(capacity).toMatchObject({
			mode: 'capable',
			override: 'on',
			workers: 6,
			reason: 'override-on',
			fileParallelism: true,
			fullyParallel: true
		});
	});

	it('reads overrides from the provided env map without touching process.env', () => {
		const capacity = resolveCapacity({
			...CAPABLE,
			env: { MAYON_TEST_PARALLEL: 'off', MAYON_TEST_MAX_WORKERS: '3' }
		});

		expect(capacity).toMatchObject({
			mode: 'low-spec',
			override: 'off',
			maxWorkers: 3,
			workers: 1
		});
	});

	it('rejects an invalid override and an invalid worker cap as exit-code 2', () => {
		expect(() => resolveCapacity({ ...CAPABLE, override: 'maybe' })).toThrow(TestCapacityError);
		expect(() => resolveCapacity({ ...CAPABLE, maxWorkers: 0 })).toThrow(
			'MAYON_TEST_MAX_WORKERS must be a positive integer'
		);
		expect(() => resolveCapacity({ ...CAPABLE, env: { MAYON_TEST_MAX_WORKERS: 'many' } })).toThrow(
			TestCapacityError
		);
	});
});

describe('formatCapacityReport', () => {
	it('prints the stable capable line', () => {
		expect(formatCapacityReport(resolveCapacity({ ...CAPABLE }))).toBe(
			'[test-capacity] mode=capable cpus=8 mem=8.0GiB override=auto workers=4 reason=thresholds-met'
		);
	});

	it('prints the stable low-spec line', () => {
		expect(
			formatCapacityReport(resolveCapacity({ logicalCpus: 4, hostMemoryBytes: 7.8 * GIB }))
		).toBe(
			'[test-capacity] mode=low-spec cpus=4 mem=7.8GiB override=auto workers=1 reason=cpus-and-memory-below-8'
		);
	});

	it('names the memory threshold when only memory is low', () => {
		expect(
			formatCapacityReport(resolveCapacity({ logicalCpus: 8, hostMemoryBytes: 7.8 * GIB }))
		).toBe(
			'[test-capacity] mode=low-spec cpus=8 mem=7.8GiB override=auto workers=1 reason=memory-below-8GiB'
		);
	});

	it('prints unknown readings explicitly', () => {
		expect(formatCapacityReport(resolveCapacity({}))).toBe(
			'[test-capacity] mode=unknown cpus=unknown mem=unknown override=auto workers=1 reason=readings-unknown'
		);
	});
});
