import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb, type FileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import { STREAM_PRESET_KEY, getStreamPreset, setStreamPreset, type StreamPreset } from './pref';

const testDb = useFileTestDb();
let fileDb: FileTestDb;
beforeAll(async () => {
	fileDb = await testDb.setup();
});
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

describe('stream preset — key identity', () => {
	it('uses exactly the streamPreset settings key', () => {
		expect(STREAM_PRESET_KEY).toBe('streamPreset');
	});
});

describe('stream preset — round-trip persistence', () => {
	it('round-trips setStreamPreset for every preset value', async () => {
		const presets: StreamPreset[] = ['calm', 'standard', 'expressive'];
		for (const preset of presets) {
			await setStreamPreset(preset);
			await expect(getStreamPreset()).resolves.toBe(preset);
		}
	});
});

describe('stream preset — defensive defaults', () => {
	it('defaults to standard when the key is missing', async () => {
		await expect(getStreamPreset()).resolves.toBe('standard');
	});

	it('defaults to standard for corrupt JSON without throwing', async () => {
		await setStreamPreset('expressive');
		await fileDb.driver.exec(
			`UPDATE settings SET value = '{not json' WHERE key = '${STREAM_PRESET_KEY}'`
		);
		await expect(getStreamPreset()).resolves.toBe('standard');
	});

	it('defaults to standard for wrong-typed values', async () => {
		await repos.settings.set(STREAM_PRESET_KEY, true as unknown as StreamPreset);
		await expect(getStreamPreset()).resolves.toBe('standard');

		await repos.settings.set(STREAM_PRESET_KEY, 3 as unknown as StreamPreset);
		await expect(getStreamPreset()).resolves.toBe('standard');

		await repos.settings.set(STREAM_PRESET_KEY, null as unknown as StreamPreset);
		await expect(getStreamPreset()).resolves.toBe('standard');
	});

	it('defaults to standard for unknown enum values', async () => {
		await repos.settings.set(STREAM_PRESET_KEY, 'cinematic' as unknown as StreamPreset);
		await expect(getStreamPreset()).resolves.toBe('standard');
	});
});
