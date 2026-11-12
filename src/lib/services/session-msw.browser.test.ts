import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { worker } from '../../../tests/mocks/browser';
import { render } from '../../../tests/browser/render';
import FetchSubject from '../../../tests/browser/fetch-subject.svelte';

beforeAll(async () => {
	await worker.start({ onUnhandledRequest: 'error', quiet: true });
});

afterAll(() => {
	worker.stop();
});

describe('MSW-backed fetch component', () => {
	it('renders the payload served by the shared auth handler', async () => {
		const { getByText } = await render(FetchSubject);

		await expect.element(getByText('Signed in as test-owner')).toBeVisible();
		await expect.element(getByText('Session mode: locked')).toBeVisible();
	});

	it('does not need an app server or database', async () => {
		const direct = await fetch('/api/auth/session', { method: 'POST' });
		const body = (await direct.json()) as { identity?: { label?: string } };

		expect(direct.status).toBe(200);
		expect(body.identity?.label).toBe('test-owner');
	});
});
