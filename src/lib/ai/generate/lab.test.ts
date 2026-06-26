import { describe, expect, it } from 'vitest';
import {
	GeneratedLabSchema,
	LabParseError,
	extractFencedJson,
	parseGeneratedLab,
	toLabContent,
	type GeneratedLab
} from './lab';

const validLab: GeneratedLab = {
	title: 'Mitochondria lab',
	intro: 'Explore how cells store energy.',
	steps: ['Stain a slide', 'Observe under a microscope'],
	checklist: [{ text: 'Slide is prepared' }, { text: 'Diagram drawn' }]
};

function fence(obj: unknown): string {
	return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
}

describe('GeneratedLabSchema (strict)', () => {
	it('accepts a well-formed lab', () => {
		expect(GeneratedLabSchema.parse(validLab)).toEqual(validLab);
	});

	it('accepts empty steps/checklist arrays', () => {
		const out = GeneratedLabSchema.parse({ ...validLab, steps: [], checklist: [] });
		expect(out.steps).toEqual([]);
		expect(out.checklist).toEqual([]);
	});

	it('rejects an extra (unknown) field', () => {
		expect(() => GeneratedLabSchema.parse({ ...validLab, surprise: 'no' })).toThrow();
	});

	it('rejects a missing field', () => {
		const { steps, ...missingSteps } = validLab;
		void steps;
		expect(() => GeneratedLabSchema.parse(missingSteps)).toThrow();
	});

	it('rejects an empty title', () => {
		expect(() => GeneratedLabSchema.parse({ ...validLab, title: '' })).toThrow();
	});

	it('rejects a non-array steps', () => {
		expect(() => GeneratedLabSchema.parse({ ...validLab, steps: 'do thing' })).toThrow();
	});

	it('rejects a checklist item without text', () => {
		expect(() => GeneratedLabSchema.parse({ ...validLab, checklist: [{ done: true }] })).toThrow();
	});

	it('coerces bare-string checklist items into {text} (models emit this)', () => {
		// Models frequently emit checklist as ["...", "..."] rather than
		// [{"text":"..."}]. The schema accepts both and normalizes to {text}.
		const out = GeneratedLabSchema.parse({
			...validLab,
			checklist: ['first criterion', 'second criterion']
		});
		expect(out.checklist).toEqual([{ text: 'first criterion' }, { text: 'second criterion' }]);
	});

	it('accepts a mix of bare-string and {text} checklist items', () => {
		const out = GeneratedLabSchema.parse({
			...validLab,
			checklist: ['bare', { text: 'object' }]
		});
		expect(out.checklist).toEqual([{ text: 'bare' }, { text: 'object' }]);
	});
});

describe('extractFencedJson', () => {
	it('pulls the first ```json fenced block', () => {
		const raw = `Here is the lab:\n${fence(validLab)}\nThanks!`;
		expect(JSON.parse(extractFencedJson(raw))).toEqual(validLab);
	});

	it('handles a bare ``` fence (no language tag)', () => {
		const raw = '```\n' + JSON.stringify(validLab) + '\n```';
		expect(JSON.parse(extractFencedJson(raw))).toEqual(validLab);
	});

	it('falls back to the trimmed whole string when there is no fence', () => {
		const raw = '\n  ' + JSON.stringify(validLab) + '  \n';
		expect(JSON.parse(extractFencedJson(raw))).toEqual(validLab);
	});

	it('keeps nested code fences intact when they appear inside a JSON string value', () => {
		// This is the real-world failure mode: a step string contains a nested
		// ```hcl ... ``` block (properly escaped within the JSON string). A naive
		// non-greedy fence regex would cut off at the inner fence. The extractor
		// must capture up to the LAST ``` so the JSON stays whole.
		const stepWithNestedFence =
			'Create main.tf with:\n\n```hcl\nprovider "random" {}\n```\n\nSave it.';
		const obj = {
			title: 'Terraform lab',
			intro: 'intro',
			steps: [stepWithNestedFence],
			checklist: [{ text: 'main.tf created' }]
		};
		const raw = 'Here you go:\n```json\n' + JSON.stringify(obj, null, 2) + '\n```\nDone.';
		// The extracted body must round-trip back to the original object.
		expect(JSON.parse(extractFencedJson(raw))).toEqual(obj);
	});
});

describe('parseGeneratedLab', () => {
	it('parses a fenced JSON block', () => {
		expect(parseGeneratedLab('prose\n' + fence(validLab))).toEqual(validLab);
	});

	it('parses bare JSON', () => {
		expect(parseGeneratedLab(JSON.stringify(validLab))).toEqual(validLab);
	});

	it('throws LabParseError (carrying raw) on non-JSON text', () => {
		const raw = 'this is not json at all';
		let err: unknown;
		try {
			parseGeneratedLab(raw);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(LabParseError);
		expect((err as LabParseError).raw).toBe(raw);
	});

	it('throws LabParseError on a schema mismatch (extra field)', () => {
		const raw = fence({ ...validLab, extra: 1 });
		expect(() => parseGeneratedLab(raw)).toThrow(LabParseError);
	});

	it('throws LabParseError on a missing field', () => {
		const { intro, ...bad } = validLab;
		void intro;
		expect(() => parseGeneratedLab(fence(bad))).toThrow(LabParseError);
	});

	it('parses a real-world payload: nested ```hcl fence in a step + bare-string checklist (regression)', () => {
		// Exact shape reported by a user: a step whose string value contains a
		// nested ```hcl ... ``` block (escaped within the JSON string), and a
		// checklist emitted as bare strings instead of {text} objects. Both the
		// nested-fence extractor and the checklist coercion must handle this.
		const raw = `\`\`\`json
{
  "title": "Your First Local Terraform Project",
  "intro": "Get hands-on with the core Terraform workflow.",
  "steps": [
    "Run \`mkdir terraform-lab\` then \`cd terraform-lab\`.",
    "Copy this into main.tf:\\n\\n\`\`\`hcl\\nprovider \\"random\\" {}\\n\\nresource \\"random_pet\\" \\"my_pet\\" {\\n  length = 2\\n}\\n\`\`\`\\n\\nSave the file.",
    "Run \`terraform apply\` and type \`yes\`."
  ],
  "checklist": [
    "main.tf contains a valid random_pet resource",
    "terraform apply printed a random pet name"
  ]
}
\`\`\``;
		const lab = parseGeneratedLab(raw);
		expect(lab.title).toBe('Your First Local Terraform Project');
		expect(lab.steps).toHaveLength(3);
		expect(lab.steps[1]).toContain('```hcl');
		expect(lab.steps[1]).toContain('provider "random" {}');
		// Bare strings coerced to {text}.
		expect(lab.checklist).toEqual([
			{ text: 'main.tf contains a valid random_pet resource' },
			{ text: 'terraform apply printed a random pet name' }
		]);
	});
});

describe('toLabContent', () => {
	it('flattens title + intro + numbered steps into one markdown body', () => {
		const { title, content } = toLabContent(validLab);
		expect(title).toBe('Mitochondria lab');
		expect(content).toBe(
			'# Mitochondria lab\n\nExplore how cells store energy.\n\n## Steps\n\n1. Stain a slide\n2. Observe under a microscope'
		);
		// Empty steps → no Steps section.
		expect(toLabContent({ ...validLab, steps: [] }).content).not.toContain('## Steps');
	});

	it('assigns a stable uuid to each checklist item (none from the model)', () => {
		const { checklist } = toLabContent(validLab);
		expect(checklist).toHaveLength(2);
		for (const item of checklist) {
			expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
			expect(item.done).toBe(false);
		}
		// Ids are unique.
		expect(new Set(checklist.map((i) => i.id)).size).toBe(checklist.length);
	});

	it('preserves checklist text', () => {
		const { checklist } = toLabContent(validLab);
		expect(checklist.map((i) => i.text)).toEqual(['Slide is prepared', 'Diagram drawn']);
	});
});
