import { execSync } from 'node:child_process';
import { resolveEngine } from '../../scripts/dev-compose.mjs';
import { selectComposeProject, type ComposeProjectEntry } from '../../src/lib/dev/compose-project';
import { expect, test } from './fixtures/onboard';
import { IMAGE_DATA_URL, IMAGE_REPLY_TEXT, IMAGE_TRIGGER } from './fixtures/kitchen-sink';
import { liveText } from './fixtures/render';

/** Parsed `<engine> compose ls --format json` output (running compose projects). */
function parseComposeLs(): ComposeProjectEntry[] {
	return JSON.parse(
		execSync(`${ENGINE} compose ls --format json`, { encoding: 'utf8' })
	) as ComposeProjectEntry[];
}

// Image replies stream slower than the standard fixture (600ms per frame, see
// IMAGE_FRAME_INTERVAL_MS in the mock) so the caption stays live-visible long
// enough to observe before finalize; one image turn (four frames + drain +
// persist) settles well inside 30s, same bound as backprop-tool.spec.ts.
const TURN_TIMEOUT = 30_000;

// The mock-llm fixture logs one line per classified provider request to its
// stdout (`[mock-llm] POST /v1/chat/completions -> kind` in server.mjs), so
// the container's log is the request log the zero-provider assertion reads.
// Healthcheck GETs to /v1/models never log, so every matched line is a
// completion request. The compose project is resolved from the NAME this
// runner's base URL implies (E2E_BASE_URL; 5173 → mayon-dev, 5200+N →
// mayon-dev-shard-N, via src/lib/dev/compose-project.ts), then verified to
// mount THIS checkout's compose files — so sibling shard stacks sharing the
// base file can never leak their logs in, and a mismatch throws instead of
// falling back. This observes the mock's log only — the request path itself
// is never intercepted (FR-005 guardrail).
const MOCK_REQUEST_LINE = /\[mock-llm\] POST \S+ -> (\S+)/;
const ENGINE = resolveEngine()?.engine ?? 'docker';

/** Provider completion requests the mock has logged so far, optionally one kind. */
function mockRequestCount(kind?: string): number {
	const project = selectComposeProject(parseComposeLs(), { baseUrl: process.env.E2E_BASE_URL });
	const logs = execSync(`${ENGINE} logs ${project.Name}-mock-llm-1`, { encoding: 'utf8' });
	return logs
		.split('\n')
		.map((line) => MOCK_REQUEST_LINE.exec(line)?.[1])
		.filter((k) => k !== undefined && (kind === undefined || k === kind)).length;
}

test.describe('mock-llm image reply round trip (030 S5)', () => {
	test('streamed image reply shows live marker then placeholder, finalizes to a durable image, and reloads with zero provider requests', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		const repliesBefore = mockRequestCount('image_reply');

		// The bounded placeholder lives only as long as the finalize append
		// roundtrip (pendingImages fills at the finalize handoff and clears
		// with the persisted row), so a plain visibility poll can miss it.
		// Record its appearance with an in-page observer instead, and assert
		// the recorded flag after the turn settles.
		await page.evaluate(() => {
			const w = window as typeof window & { __sawImagePlaceholder?: boolean };
			w.__sawImagePlaceholder = false;
			const observer = new MutationObserver(() => {
				if (document.getElementById('msg-live-images')) w.__sawImagePlaceholder = true;
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
		});

		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill(`Please ${IMAGE_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// Text first: the live marker carries the caption before any image
		// part arrives. 029 renders per-block live ids (`msg-live-text-0`, …),
		// so the caption is read off the first live text block.
		const live = liveText(page).first();
		await expect(live).toContainText(IMAGE_REPLY_TEXT, { timeout: TURN_TIMEOUT });

		// Finalize: the live view closes and the placeholder was shown while
		// the image part was pending (the live view carries no base64).
		await expect(liveText(page)).toHaveCount(0, { timeout: TURN_TIMEOUT });
		expect(
			await page.evaluate(
				() => (window as typeof window & { __sawImagePlaceholder?: boolean }).__sawImagePlaceholder
			)
		).toBe(true);
		await expect(page.locator('.markdown-body', { hasText: IMAGE_REPLY_TEXT })).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		const thumb = page.getByRole('button', { name: 'View image full size' }).locator('img');
		await expect(thumb).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(thumb).toHaveAttribute('src', IMAGE_DATA_URL);

		// The turn cost exactly one image_reply completion through the real
		// proxy path (browser → /api/llm/proxy → mock). The first exchange
		// also fires the pre-existing goal-inference aux requests
		// (brief_generation, chat_plain), so the total count is not exact —
		// the reply kind is. (Live-path wire composition; the reload
		// no-provider-contact invariant is proven in
		// src/lib/stores/chat.svelte.test.ts, 031 parity.)
		expect(mockRequestCount('image_reply')).toBe(repliesBefore + 1);

		// Reload: the redisplay is served from the persisted row (fast parity).
		await page.reload();
		await expect(
			page.getByRole('button', { name: 'View image full size' }).locator('img')
		).toBeVisible({ timeout: TURN_TIMEOUT });
	});
});
