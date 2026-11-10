import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { ContextGauge as ContextGaugeModel } from '#lib/chat/context-usage.js';

import { render } from '../../../../tests/browser/render';
import ContextGauge from './ContextGauge.svelte';

function gauge(overrides: Partial<ContextGaugeModel> = {}): ContextGaugeModel {
	return {
		usedTokens: 2000,
		provenance: 'reported',
		anchorMessageId: null,
		anchorModelId: null,
		anchorUsage: null,
		limit: 8000,
		limitSource: 'catalog',
		remainingPct: 0.75,
		state: 'normal',
		...overrides
	};
}

describe('ContextGauge', () => {
	it('renders nothing without a gauge', async () => {
		const { getByRole } = await render(ContextGauge, { gauge: null });
		expect(getByRole('button', { name: 'Context usage details' }).query()).toBeNull();
	});

	it('renders the usage summary with a details trigger', async () => {
		const { getByRole, getByText } = await render(ContextGauge, { gauge: gauge() });

		await expect.element(getByRole('button', { name: 'Context usage details' })).toBeVisible();
		await expect.element(getByText(/2\.0k \/ 8\.0k/)).toBeVisible();
		await expect.element(getByText(/\(25%\)/)).toBeVisible();
		expect(getByRole('status').query()).toBeNull();
	});

	it('announces the critical state with the escalation guidance', async () => {
		const { getByRole } = await render(ContextGauge, {
			gauge: gauge({ usedTokens: 9500, limit: 10000, state: 'critical', remainingPct: 0.05 })
		});

		const status = getByRole('status');
		await expect.element(status).toBeVisible();
		await expect.element(status).toHaveAttribute('data-state', 'critical');
		await expect.element(status).toHaveAttribute('data-provenance', 'reported');
		await expect
			.element(status)
			.toHaveAttribute(
				'data-tip',
				'Context nearly full — start a new chat or branch to free context'
			);
	});

	it('shows the contract rows in the details popover', async () => {
		const { getByRole, getByText } = await render(ContextGauge, {
			gauge: gauge({
				usedTokens: 1500,
				provenance: 'estimated',
				anchorModelId: 'other-model',
				anchorUsage: { promptTokens: 1000, completionTokens: 500, modelId: 'other-model' }
			})
		});

		await userEvent.click(getByRole('button', { name: 'Context usage details' }));

		await expect.element(getByText('Used')).toBeVisible();
		await expect.element(getByText('Window')).toBeVisible();
		await expect.element(getByText('8.0k · model catalog')).toBeVisible();
		await expect.element(getByText('History + instructions')).toBeVisible();
		await expect.element(getByText('Latest reply')).toBeVisible();
		await expect
			.element(
				getByText('estimated from context size · model: other-model (differs from active model)')
			)
			.toBeVisible();
	});

	it('humanizes the limit source in the Window row', async () => {
		const { getByRole, getByText } = await render(ContextGauge, {
			gauge: gauge({ limit: 32768, limitSource: 'model-listing' })
		});

		await userEvent.click(getByRole('button', { name: 'Context usage details' }));
		await expect.element(getByText('32.8k · provider model listing')).toBeVisible();
	});

	it('points at declaring a window when the limit is unknown', async () => {
		const { getByRole, getByText } = await render(ContextGauge, {
			gauge: gauge({ limit: null, limitSource: 'unknown', state: 'no-limit', remainingPct: null })
		});

		const trigger = getByRole('button', { name: 'Context usage details' });
		const summary = getByText(/window unknown/);
		await expect
			.element(summary)
			.toHaveAttribute(
				'title',
				'reported usage — set "Context window" on the provider settings card to show the limit'
			);
		await userEvent.click(trigger);
		await expect
			.element(getByText('unknown — set "Context window" on the provider card'))
			.toBeVisible();
	});
});
