import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = join(repoRoot, 'scripts', 'check-dependency-direction.mjs');

function runDirectionCheck(fixture: string): { code: number; stdout: string } {
	try {
		return {
			code: 0,
			stdout: execFileSync(process.execPath, [script, fixture], { encoding: 'utf8' })
		};
	} catch (error) {
		const err = error as { status?: number; stdout?: string };
		return { code: err.status ?? 1, stdout: err.stdout ?? '' };
	}
}

it('reports every violation class with file and rule (violating fixtures)', () => {
	const { code, stdout } = runDirectionCheck('tests/fixtures/boundaries/violating');
	expect(code).toBe(1);
	expect(stdout).toMatch(/static-deep-import\.ts:\d+: boundary violation \(R1\)/);
	expect(stdout).toMatch(/type-only-deep-import\.ts:\d+: boundary violation \(R1\)/);
	expect(stdout).toMatch(/dynamic-deep-import\.ts:\d+: boundary violation \(R2\)/);
	expect(stdout).toMatch(/db-imports-app\.ts:\d+: boundary violation \(R3\)/);
	expect(stdout).toMatch(/inline-disable\.ts:\d+: boundary violation \(R4\)/);
});

it('passes the clean fixture tree', () => {
	const { code, stdout } = runDirectionCheck('tests/fixtures/boundaries/clean');
	expect(code).toBe(0);
	expect(stdout.trim()).toBe('boundary check: clean');
});
