import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import {
	expectedComposeProjectName,
	selectComposeProject,
	type ComposeProjectEntry
} from './compose-project';

// Synthetic `docker compose ls --format json` listings — no Docker required.
const REPO = '/checkout';
const BASE_FILE = path.join(REPO, 'docker-compose.dev.yml');
const SHARD_FILE = path.join(REPO, 'docker-compose.dev.shard.yml');

function entry(name: string, configFiles: string): ComposeProjectEntry {
	return { Name: name, ConfigFiles: configFiles };
}

// What concurrent stacks look like: the base stack plus two sibling shards,
// all mounting the SAME base compose file (the bug this selector replaces).
const CONCURRENT = [
	entry('mayon-dev', BASE_FILE),
	entry('mayon-dev-shard-1', `${BASE_FILE},${SHARD_FILE}`),
	entry('mayon-dev-shard-2', `${BASE_FILE},${SHARD_FILE}`)
];

const afterEachCleanup: Array<() => void> = [];
afterEach(() => {
	while (afterEachCleanup.length > 0) afterEachCleanup.pop()?.();
});

describe('expectedComposeProjectName', () => {
	it('maps the base dev port 5173 to mayon-dev', () => {
		expect(expectedComposeProjectName('http://127.0.0.1:5173')).toBe('mayon-dev');
	});

	it('maps shard ports 5201-5299 to mayon-dev-shard-N', () => {
		expect(expectedComposeProjectName('http://127.0.0.1:5201')).toBe('mayon-dev-shard-1');
		expect(expectedComposeProjectName('http://127.0.0.1:5202')).toBe('mayon-dev-shard-2');
		expect(expectedComposeProjectName('http://127.0.0.1:5299')).toBe('mayon-dev-shard-99');
	});

	it('throws naming the port for anything that is not a dev-stack port', () => {
		expect(() => expectedComposeProjectName('http://127.0.0.1:8080')).toThrow(/8080/);
		// 5200 would be shard 0, which dev-compose.mjs rejects (shards are 1+).
		expect(() => expectedComposeProjectName('http://127.0.0.1:5200')).toThrow(/5200/);
	});
});

describe('selectComposeProject', () => {
	it('picks the base-URL-implied project out of a concurrent base+sibling-shard listing (base direction)', () => {
		expect(
			selectComposeProject(CONCURRENT, { baseUrl: 'http://127.0.0.1:5173', repoRoot: REPO })
		).toEqual(entry('mayon-dev', BASE_FILE));
	});

	it('picks the base-URL-implied project out of a concurrent base+sibling-shard listing (shard directions)', () => {
		expect(
			selectComposeProject(CONCURRENT, { baseUrl: 'http://127.0.0.1:5201', repoRoot: REPO })
		).toEqual(entry('mayon-dev-shard-1', `${BASE_FILE},${SHARD_FILE}`));
		expect(
			selectComposeProject(CONCURRENT, { baseUrl: 'http://127.0.0.1:5202', repoRoot: REPO })
		).toEqual(entry('mayon-dev-shard-2', `${BASE_FILE},${SHARD_FILE}`));
	});

	it('selects mayon-dev when only the base stack is running', () => {
		expect(
			selectComposeProject([entry('mayon-dev', BASE_FILE)], {
				baseUrl: 'http://127.0.0.1:5173',
				repoRoot: REPO
			})
		).toEqual(entry('mayon-dev', BASE_FILE));
	});

	it('throws naming the port for a baseUrl outside the dev-stack ports', () => {
		expect(() =>
			selectComposeProject(CONCURRENT, { baseUrl: 'http://127.0.0.1:4173', repoRoot: REPO })
		).toThrow(/4173/);
	});

	it('throws naming the expected project when it is absent from the listing', () => {
		const siblingsOnly = CONCURRENT.filter((p) => p.Name !== 'mayon-dev');
		expect(() =>
			selectComposeProject(siblingsOnly, { baseUrl: 'http://127.0.0.1:5173', repoRoot: REPO })
		).toThrow(/mayon-dev/);
		expect(() =>
			selectComposeProject([entry('mayon-dev', BASE_FILE)], {
				baseUrl: 'http://127.0.0.1:5201',
				repoRoot: REPO
			})
		).toThrow(/mayon-dev-shard-1/);
	});

	it('throws when the name matches but ConfigFiles lacks this checkout’s base file', () => {
		const foreignCheckout = entry('mayon-dev', '/elsewhere/docker-compose.dev.yml');
		expect(() =>
			selectComposeProject([foreignCheckout], {
				baseUrl: 'http://127.0.0.1:5173',
				repoRoot: REPO
			})
		).toThrow(/mayon-dev/);
		expect(() =>
			selectComposeProject([foreignCheckout], {
				baseUrl: 'http://127.0.0.1:5173',
				repoRoot: REPO
			})
		).toThrow(/docker-compose\.dev\.yml/);
	});

	it('requires the shard-override file for shard projects (base file alone is not enough)', () => {
		const baseFilesOnly = entry('mayon-dev-shard-1', BASE_FILE);
		expect(() =>
			selectComposeProject([baseFilesOnly], {
				baseUrl: 'http://127.0.0.1:5201',
				repoRoot: REPO
			})
		).toThrow(/mayon-dev-shard-1/);
		expect(() =>
			selectComposeProject([baseFilesOnly], {
				baseUrl: 'http://127.0.0.1:5201',
				repoRoot: REPO
			})
		).toThrow(/docker-compose\.dev\.shard\.yml/);
	});

	it('requires the base file for shard projects (override alone is not enough)', () => {
		const overrideOnly = entry('mayon-dev-shard-1', SHARD_FILE);
		expect(() =>
			selectComposeProject([overrideOnly], {
				baseUrl: 'http://127.0.0.1:5201',
				repoRoot: REPO
			})
		).toThrow(/docker-compose\.dev\.yml/);
	});

	it('defaults baseUrl to E2E_BASE_URL when no option is passed', () => {
		const previous = process.env.E2E_BASE_URL;
		process.env.E2E_BASE_URL = 'http://127.0.0.1:5202';
		afterEachCleanup.push(() => {
			if (previous === undefined) delete process.env.E2E_BASE_URL;
			else process.env.E2E_BASE_URL = previous;
		});
		expect(selectComposeProject(CONCURRENT, { repoRoot: REPO })).toEqual(
			entry('mayon-dev-shard-2', `${BASE_FILE},${SHARD_FILE}`)
		);
	});

	it('defaults baseUrl to http://127.0.0.1:5173 and repoRoot to process.cwd()', () => {
		const previous = process.env.E2E_BASE_URL;
		delete process.env.E2E_BASE_URL;
		afterEachCleanup.push(() => {
			if (previous !== undefined) process.env.E2E_BASE_URL = previous;
		});
		expect(
			selectComposeProject([entry('mayon-dev', path.join(process.cwd(), 'docker-compose.dev.yml'))])
		).toEqual(entry('mayon-dev', path.join(process.cwd(), 'docker-compose.dev.yml')));
	});
});
