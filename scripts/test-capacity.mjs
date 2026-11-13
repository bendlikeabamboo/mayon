// Capability gate for the tiered test suite
// (specs/032-test-suite-tiering/contracts/capacity-gate.md).
//
// `resolveCapacity(readings)` is pure: every signal and override arrives in the
// readings object. `readCapacity()` is the only I/O entry point and gathers the
// OS, cgroup v2, and cgroup v1 signals once per run.
//
// Readings shape (all optional; unreadable/missing means unknown):
//   logicalCpus          host logical CPU count
//   hostMemoryBytes      host total memory
//   cgroupCpus           cgroup CPU quota expressed in CPUs (quota / period)
//   cgroupMemoryBytes    cgroup memory.max (or v1 limit) in bytes
//   cgroupMemoryHighBytes cgroup memory.high in bytes
//   signals              source labels recorded while reading
//   env                  environment map for MAYON_TEST_* overrides
//   override             explicit override ('auto' | 'on' | 'off')
//   maxWorkers           explicit worker cap (positive integer)
//
// The effective CPU/memory values are the minimum of the host reading and every
// readable cgroup limit, because either can be the real constraint.
//
// Low-spec is intentionally narrow: 2 or fewer logical CPUs, or less than 8 GiB
// usable memory. A GitHub-hosted standard runner (4 vCPU / 16 GiB) is capable,
// so Vitest runs file-parallel there. When no explicit worker cap is given,
// `workers` is null and the test configs omit `maxWorkers`, letting Vitest size
// its own pool from the available cores.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import process from 'node:process';

export const GIB = 1024 ** 3;
export const LOW_SPEC_MAX_CPUS = 2;
export const MIN_CAPABLE_MEMORY_BYTES = 8 * GIB;
export const CGROUP_ROOT = '/sys/fs/cgroup';

/** Configuration error raised with `process.exitCode = 2` semantics. */
export class TestCapacityError extends Error {
	exitCode = 2;

	constructor(message) {
		super(message);
		this.name = 'TestCapacityError';
	}
}

function positiveNumber(value) {
	if (typeof value === 'string') {
		if (value.trim() === '') return null;
		value = Number(value);
	}
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null;
	return value;
}

function memoryBytes(value) {
	const bytes = positiveNumber(value);
	// cgroup v1 reports "unlimited" as a huge sentinel near 2^63; treat it as
	// unreadable so the host reading applies.
	if (bytes === null || bytes >= Number.MAX_SAFE_INTEGER) return null;
	return Math.floor(bytes);
}

function resolveCpus(readings) {
	const host = positiveNumber(
		readings.logicalCpus ?? readings.cpus ?? readings.availableParallelism
	);
	const cgroup = positiveNumber(readings.cgroupCpus ?? readings.cgroupCpuCount);
	const known = [host, cgroup].filter((value) => value !== null).map((value) => Math.floor(value));
	if (known.length === 0) return null;
	return Math.max(1, Math.min(...known));
}

function resolveMemory(readings) {
	const candidates = [
		readings.hostMemoryBytes,
		readings.memoryBytes,
		readings.totalmem,
		readings.cgroupMemoryBytes,
		readings.cgroupMemoryMaxBytes,
		readings.cgroupMemoryHighBytes
	]
		.map(memoryBytes)
		.filter((value) => value !== null);
	if (candidates.length === 0) return null;
	return Math.min(...candidates);
}

function resolveOverride(readings) {
	const env = readings.env ?? {};
	const override = readings.override ?? env.MAYON_TEST_PARALLEL ?? 'auto';
	if (override !== 'auto' && override !== 'on' && override !== 'off') {
		throw new TestCapacityError(
			`MAYON_TEST_PARALLEL must be auto, on, or off, received '${override}'`
		);
	}
	return override;
}

function resolveMaxWorkers(readings) {
	const env = readings.env ?? {};
	const raw = readings.maxWorkers !== undefined ? readings.maxWorkers : env.MAYON_TEST_MAX_WORKERS;
	if (raw === undefined || raw === null || raw === '') return null;
	const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new TestCapacityError(
			`MAYON_TEST_MAX_WORKERS must be a positive integer, received '${raw}'`
		);
	}
	return parsed;
}

function classify(logicalCpus, usableMemoryBytes) {
	if (logicalCpus === null || usableMemoryBytes === null) {
		const reason =
			logicalCpus === null && usableMemoryBytes === null
				? 'readings-unknown'
				: logicalCpus === null
					? 'cpus-unknown'
					: 'memory-unknown';
		return { mode: 'unknown', reason };
	}
	const cpusLow = logicalCpus <= LOW_SPEC_MAX_CPUS;
	const memoryLow = usableMemoryBytes < MIN_CAPABLE_MEMORY_BYTES;
	if (cpusLow && memoryLow) {
		return { mode: 'low-spec', reason: 'cpus-and-memory-low' };
	}
	if (memoryLow) {
		return { mode: 'low-spec', reason: 'memory-below-8GiB' };
	}
	if (cpusLow) {
		return { mode: 'low-spec', reason: 'cpus-at-or-below-2' };
	}
	return { mode: 'capable', reason: 'thresholds-met' };
}

/**
 * Pure capability decision. Never reads `process.env` or the live filesystem;
 * pass the readings and overrides in explicitly.
 */
export function resolveCapacity(readings = {}) {
	const logicalCpus = resolveCpus(readings);
	const usableMemoryBytes = resolveMemory(readings);
	const override = resolveOverride(readings);
	const maxWorkers = resolveMaxWorkers(readings);

	let mode;
	let reason;
	if (override === 'off') {
		mode = 'low-spec';
		reason = 'override-off';
	} else if (override === 'on') {
		if (maxWorkers === null) {
			throw new TestCapacityError("override 'on' requires MAYON_TEST_MAX_WORKERS");
		}
		mode = 'capable';
		reason = 'override-on';
	} else {
		const classified = classify(logicalCpus, usableMemoryBytes);
		mode = classified.mode;
		reason = classified.reason;
	}

	let workers = 1;
	if (override === 'on') {
		// Forced parallel mode uses the explicit worker count verbatim: an
		// intentional oversubscription is reported, never silently clamped.
		workers = maxWorkers;
	} else if (mode === 'capable') {
		// No implicit cap: null tells the Vitest configs to omit `maxWorkers`
		// and let the runner size its pool. An explicit cap still wins.
		workers = maxWorkers;
	}

	return {
		mode,
		logicalCpus,
		usableMemoryBytes,
		signals: Array.isArray(readings.signals) ? [...readings.signals] : [],
		override,
		maxWorkers,
		workers,
		fileParallelism: mode === 'capable',
		fullyParallel: mode === 'capable',
		reason
	};
}

function readText(path) {
	try {
		return readFileSync(path, 'utf8').trim();
	} catch {
		return null;
	}
}

function readOsReadings(signals) {
	let logicalCpus = null;
	let available = 0;
	try {
		available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 0;
	} catch {
		// fall through to os.cpus()
	}
	try {
		const fallback = os.cpus().length;
		const value = available > 0 ? available : fallback;
		if (Number.isInteger(value) && value >= 1) {
			logicalCpus = value;
			signals.push(available > 0 ? 'os.availableParallelism' : 'os.cpus');
		}
	} catch {
		// unreadable -> unknown
	}

	let hostMemoryBytes = null;
	try {
		const total = os.totalmem();
		if (Number.isFinite(total) && total >= 1) {
			hostMemoryBytes = total;
			signals.push('os.totalmem');
		}
	} catch {
		// unreadable -> unknown
	}

	return { logicalCpus, hostMemoryBytes };
}

function readCgroupV2Cpus(signals) {
	const raw = readText(join(CGROUP_ROOT, 'cpu.max'));
	if (raw === null) return null;
	const [quotaRaw, periodRaw] = raw.split(/\s+/);
	if (quotaRaw === 'max') return null;
	const quota = Number(quotaRaw);
	const period = Number(periodRaw);
	if (!Number.isFinite(quota) || !Number.isFinite(period) || quota < 1 || period < 1) return null;
	signals.push('cgroup-v2-cpu.max');
	return quota / period;
}

function readCgroupV1Cpus(signals) {
	const quota = Number(readText(join(CGROUP_ROOT, 'cpu', 'cpu.cfs_quota_us')));
	const period = Number(readText(join(CGROUP_ROOT, 'cpu', 'cpu.cfs_period_us')));
	if (!Number.isFinite(quota) || !Number.isFinite(period) || quota < 1 || period < 1) return null;
	signals.push('cgroup-v1-cpu.cfs_quota_us');
	return quota / period;
}

function readMemoryFile(path, signal) {
	const raw = readText(path);
	if (raw === null || raw === 'max') return null;
	const bytes = memoryBytes(Number(raw));
	if (bytes === null) return null;
	return { bytes, signal };
}

function readCgroupMemory(signals) {
	const values = [];
	const max = readMemoryFile(join(CGROUP_ROOT, 'memory.max'), 'cgroup-v2-memory.max');
	if (max) {
		signals.push(max.signal);
		values.push(max.bytes);
	}
	const high = readMemoryFile(join(CGROUP_ROOT, 'memory.high'), 'cgroup-v2-memory.high');
	if (high) {
		signals.push(high.signal);
		values.push(high.bytes);
	}
	if (values.length > 0) return Math.min(...values);

	const v1 = readMemoryFile(
		join(CGROUP_ROOT, 'memory', 'memory.limit_in_bytes'),
		'cgroup-v1-memory.limit_in_bytes'
	);
	if (v1) {
		signals.push(v1.signal);
		return v1.bytes;
	}
	return null;
}

/** Read live OS/cgroup signals and resolve the run's capability profile. */
export function readCapacity(env = process.env) {
	const signals = [];
	const osReadings = readOsReadings(signals);
	const cgroupCpus = readCgroupV2Cpus(signals) ?? readCgroupV1Cpus(signals);
	const cgroupMemoryBytes = readCgroupMemory(signals);

	return resolveCapacity({
		...osReadings,
		cgroupCpus,
		cgroupMemoryBytes,
		signals,
		env
	});
}

function formatMemory(bytes) {
	if (bytes === null) return 'unknown';
	return `${(bytes / GIB).toFixed(1)}GiB`;
}

/** Stable one-line report required at the start of every runner. */
export function formatCapacityReport(capacity) {
	const cpus = capacity?.logicalCpus ?? 'unknown';
	return [
		'[test-capacity]',
		`mode=${capacity?.mode ?? 'unknown'}`,
		`cpus=${cpus}`,
		`mem=${formatMemory(capacity?.usableMemoryBytes ?? null)}`,
		`override=${capacity?.override ?? 'auto'}`,
		`workers=${capacity?.workers ?? 'auto'}`,
		`reason=${capacity?.reason ?? 'readings-unknown'}`
	].join(' ');
}

/** Resolve (if needed), print the stable report line, and return the profile. */
export function reportCapacity(capacity = readCapacity()) {
	console.log(formatCapacityReport(capacity));
	return capacity;
}
