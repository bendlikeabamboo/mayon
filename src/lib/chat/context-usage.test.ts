import { describe, it, expect } from 'vitest';
import { deriveContextGauge, LOW_REMAINING, CRITICAL_REMAINING } from './context-usage';
import type { ContextGaugeCandidate } from './context-usage';

function candidate(
	overrides: Partial<ContextGaugeCandidate> & { id: string }
): ContextGaugeCandidate {
	return {
		kind: 'assistant_message',
		ord: 0,
		tokens: null,
		usage: null,
		...overrides
	};
}

const base = { assembledChars: 0, activeModelId: 'mock-sink', declaredWindow: null };

describe('deriveContextGauge', () => {
	it('exports thresholds as fractions', () => {
		expect(LOW_REMAINING).toBe(0.25);
		expect(CRITICAL_REMAINING).toBe(0.1);
	});

	it('picks the highest-ord assistant candidate as anchor', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 100, modelId: 'mock-sink' } }),
				candidate({ id: 'm2', ord: 5, usage: { totalTokens: 200, modelId: 'mock-sink' } }),
				candidate({ id: 'm3', ord: 3, usage: { totalTokens: 150, modelId: 'mock-sink' } })
			]
		});
		expect(gauge.usedTokens).toBe(200);
		expect(gauge.anchorMessageId).toBe('m2');
		expect(gauge.provenance).toBe('reported');
	});

	it('ignores non-assistant candidates even with usage', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({
					id: 't1',
					kind: 'tool_result',
					ord: 9,
					usage: { totalTokens: 999, modelId: 'mock-sink' }
				}),
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 100, modelId: 'mock-sink' } })
			]
		});
		expect(gauge.anchorMessageId).toBe('m1');
		expect(gauge.usedTokens).toBe(100);
	});

	it('ignores assistant candidates without usage and without tokens', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({ id: 'm1', ord: 9, tokens: null, usage: null }),
				candidate({ id: 'm2', ord: 1, tokens: 50, usage: null })
			]
		});
		expect(gauge.anchorMessageId).toBe('m2');
		expect(gauge.usedTokens).toBe(50);
	});

	it('prefers usage.totalTokens over the tokens column', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({
					id: 'm1',
					ord: 1,
					tokens: 77,
					usage: { totalTokens: 100, modelId: 'mock-sink' }
				})
			]
		});
		expect(gauge.usedTokens).toBe(100);
	});

	it('sums prompt+completion when totalTokens is missing', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({
					id: 'm1',
					ord: 1,
					usage: { promptTokens: 80, completionTokens: 20, modelId: 'mock-sink' }
				})
			]
		});
		expect(gauge.usedTokens).toBe(100);
		expect(gauge.provenance).toBe('reported');
		expect(gauge.anchorUsage).toEqual({
			promptTokens: 80,
			completionTokens: 20,
			modelId: 'mock-sink'
		});
	});

	it('falls back to the tokens column when usage is null', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [candidate({ id: 'm1', ord: 1, tokens: 42 })]
		});
		expect(gauge.usedTokens).toBe(42);
		expect(gauge.provenance).toBe('reported');
		expect(gauge.anchorModelId).toBe(null);
	});

	it('marks provenance estimated when anchor model differs from active model', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 100, modelId: 'other-model' } })
			]
		});
		expect(gauge.usedTokens).toBe(100);
		expect(gauge.provenance).toBe('estimated');
		expect(gauge.anchorModelId).toBe('other-model');
	});

	it('keeps provenance reported when anchor model matches', () => {
		const gauge = deriveContextGauge({
			...base,
			activeModelId: 'z-ai/glm-5.2',
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 100, modelId: 'z-ai/glm-5.2' } })
			]
		});
		expect(gauge.provenance).toBe('reported');
	});

	it('estimates from assembledChars when there are no candidates', () => {
		expect(deriveContextGauge({ ...base, candidates: [], assembledChars: 0 })).toMatchObject({
			usedTokens: 0,
			provenance: 'estimated',
			anchorMessageId: null,
			anchorModelId: null
		});
		expect(deriveContextGauge({ ...base, candidates: [], assembledChars: 400 }).usedTokens).toBe(
			100
		);
		expect(deriveContextGauge({ ...base, candidates: [], assembledChars: 401 }).usedTokens).toBe(
			101
		);
	});

	it('declared window beats catalog', () => {
		const gauge = deriveContextGauge({
			...base,
			activeModelId: 'z-ai/glm-5.2',
			declaredWindow: 50000,
			candidates: []
		});
		expect(gauge.limit).toBe(50000);
		expect(gauge.limitSource).toBe('provider-declared');
	});

	it('resolves catalog limit for router-prefixed ids', () => {
		const gauge = deriveContextGauge({
			...base,
			activeModelId: 'z-ai/glm-5.2',
			candidates: []
		});
		expect(gauge.limit).toBe(1000000);
		expect(gauge.limitSource).toBe('catalog');
	});

	it('yields no limit for unknown model without declared window', () => {
		const gauge = deriveContextGauge({ ...base, candidates: [] });
		expect(gauge.limit).toBe(null);
		expect(gauge.limitSource).toBe('unknown');
		expect(gauge.remainingPct).toBe(null);
		expect(gauge.state).toBe('no-limit');
	});

	it('ignores invalid declared windows (zero, negative, non-integer)', () => {
		for (const declaredWindow of [0, -100, 12.5]) {
			const gauge = deriveContextGauge({
				...base,
				activeModelId: 'gpt-4o',
				declaredWindow,
				candidates: []
			});
			expect(gauge.limit).toBe(128000);
			expect(gauge.limitSource).toBe('catalog');
		}
	});

	it('uses listed window with limitSource model-listing when declared window is absent', () => {
		const gauge = deriveContextGauge({ ...base, listedWindow: 64000, candidates: [] });
		expect(gauge.limit).toBe(64000);
		expect(gauge.limitSource).toBe('model-listing');
	});

	it('declared window beats listed window', () => {
		const gauge = deriveContextGauge({
			...base,
			activeModelId: 'gpt-4o',
			declaredWindow: 50000,
			listedWindow: 64000,
			candidates: []
		});
		expect(gauge.limit).toBe(50000);
		expect(gauge.limitSource).toBe('provider-declared');
	});

	it('listed window beats catalog', () => {
		const gauge = deriveContextGauge({
			...base,
			activeModelId: 'gpt-4o',
			listedWindow: 64000,
			candidates: []
		});
		expect(gauge.limit).toBe(64000);
		expect(gauge.limitSource).toBe('model-listing');
	});

	it('ignores invalid listed windows (zero, negative, non-integer, null) and falls through', () => {
		for (const listedWindow of [0, -1000, 2.5, null]) {
			const gauge = deriveContextGauge({
				...base,
				activeModelId: 'gpt-4o',
				listedWindow,
				candidates: []
			});
			expect(gauge.limit).toBe(128000);
			expect(gauge.limitSource).toBe('catalog');
		}

		const unknown = deriveContextGauge({ ...base, listedWindow: 2.5, candidates: [] });
		expect(unknown.limit).toBe(null);
		expect(unknown.limitSource).toBe('unknown');
		expect(unknown.remainingPct).toBe(null);
		expect(unknown.state).toBe('no-limit');
	});

	it('falls through to listed window when declared window is invalid', () => {
		const gauge = deriveContextGauge({
			...base,
			activeModelId: 'gpt-4o',
			declaredWindow: 0,
			listedWindow: 64000,
			candidates: []
		});
		expect(gauge.limit).toBe(64000);
		expect(gauge.limitSource).toBe('model-listing');
	});

	it('classifies thresholds: exactly 25% remaining is low, just above is normal', () => {
		const low = deriveContextGauge({
			...base,
			declaredWindow: 1000,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 750, modelId: 'mock-sink' } })
			]
		});
		expect(low.remainingPct).toBeCloseTo(0.25);
		expect(low.state).toBe('low');

		const normal = deriveContextGauge({
			...base,
			declaredWindow: 1000,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 749, modelId: 'mock-sink' } })
			]
		});
		expect(normal.state).toBe('normal');
	});

	it('classifies thresholds: exactly 10% remaining is critical, over-limit clamps to 0', () => {
		const critical = deriveContextGauge({
			...base,
			declaredWindow: 1000,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 900, modelId: 'mock-sink' } })
			]
		});
		expect(critical.remainingPct).toBeCloseTo(0.1);
		expect(critical.state).toBe('critical');

		const over = deriveContextGauge({
			...base,
			declaredWindow: 1000,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 1500, modelId: 'mock-sink' } })
			]
		});
		expect(over.remainingPct).toBe(0);
		expect(over.state).toBe('critical');
	});

	it('never throws on empty input', () => {
		const gauge = deriveContextGauge({
			candidates: [],
			assembledChars: 0,
			activeModelId: null,
			declaredWindow: null
		});
		expect(gauge).toMatchObject({
			usedTokens: 0,
			provenance: 'estimated',
			limit: null,
			limitSource: 'unknown',
			remainingPct: null,
			state: 'no-limit'
		});
	});

	it('anchors on a tokens-only candidate even when it has the highest ord', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({ id: 'm1', ord: 1, usage: { totalTokens: 100, modelId: 'mock-sink' } }),
				candidate({ id: 'm2', ord: 5, tokens: 88, usage: null })
			]
		});
		expect(gauge.anchorMessageId).toBe('m2');
		expect(gauge.usedTokens).toBe(88);
		expect(gauge.anchorModelId).toBe(null);
		expect(gauge.provenance).toBe('reported');
	});

	it('uses usage.totalTokens directly even when prompt+completion are also present', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({
					id: 'm1',
					ord: 1,
					usage: {
						promptTokens: 500,
						completionTokens: 500,
						totalTokens: 100,
						modelId: 'mock-sink'
					}
				})
			]
		});
		expect(gauge.usedTokens).toBe(100);
	});

	it('partial usage without completionTokens falls back to the tokens column', () => {
		const gauge = deriveContextGauge({
			...base,
			candidates: [
				candidate({
					id: 'm1',
					ord: 1,
					tokens: 42,
					usage: { promptTokens: 500, modelId: 'mock-sink' }
				})
			]
		});
		expect(gauge.usedTokens).toBe(42);
		expect(gauge.provenance).toBe('reported');
	});

	it('empty candidates and zero assembledChars yield usedTokens 0, estimated', () => {
		expect(deriveContextGauge({ ...base, candidates: [], assembledChars: 0 })).toMatchObject({
			usedTokens: 0,
			provenance: 'estimated'
		});
	});

	it('snap-to-reported: adding a reported anchor replaces the assembledChars estimate', () => {
		const before = deriveContextGauge({
			...base,
			activeModelId: 'model-a',
			candidates: [],
			assembledChars: 1600
		});
		expect(before.usedTokens).toBe(400);
		expect(before.provenance).toBe('estimated');

		const after = deriveContextGauge({
			...base,
			activeModelId: 'model-a',
			assembledChars: 1600,
			candidates: [candidate({ id: 'm1', ord: 1, usage: { totalTokens: 250, modelId: 'model-a' } })]
		});
		expect(after.usedTokens).toBe(250);
		expect(after.provenance).toBe('reported');
		expect(after.anchorMessageId).toBe('m1');
	});

	it('provenance follows the active model: mismatch → estimated, match → reported again', () => {
		const candidates = [
			candidate({ id: 'm1', ord: 1, usage: { totalTokens: 300, modelId: 'model-a' } })
		];

		const mismatched = deriveContextGauge({ ...base, activeModelId: 'model-b', candidates });
		expect(mismatched.usedTokens).toBe(300);
		expect(mismatched.anchorModelId).toBe('model-a');
		expect(mismatched.provenance).toBe('estimated');

		const matched = deriveContextGauge({ ...base, activeModelId: 'model-a', candidates });
		expect(matched.usedTokens).toBe(300);
		expect(matched.provenance).toBe('reported');
	});
});
