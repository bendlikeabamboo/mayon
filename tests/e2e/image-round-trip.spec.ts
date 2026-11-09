import { execSync } from 'node:child_process';
import { expect, test } from './fixtures/onboard';
import { IMAGE_DATA_URL, IMAGE_REPLY_TEXT, IMAGE_TRIGGER } from './fixtures/kitchen-sink';

// Image replies stream slower than the standard fixture (600ms per frame, see
// IMAGE_FRAME_INTERVAL_MS in the mock) so the caption stays live-visible long
// enough to observe before finalize; one image turn (four frames + drain +
// persist) settles well inside 30s, same bound as backprop-tool.spec.ts.
const TURN_TIMEOUT = 30_000;

// The mock-llm fixture logs one line per classified provider request to its
// stdout (`[mock-llm] POST /v1/chat/completions -> kind` in server.mjs), so
// the container's log is the request log the zero-provider assertion reads.
// Healthcheck GETs to /v1/models never log, so every matched line is a
// completion request. Resolving the compose project through `docker compose
// ls` (matched against this checkout's dev compose file) stays correct when
// several dev stacks run side by side. This observes the mock's log only —
// the request path itself is never intercepted (FR-005 guardrail).
const COMPOSE_FILE = `${process.cwd()}/docker-compose.dev.yml`;
const MOCK_REQUEST_LINE = /\[mock-llm\] POST \S+ -> (\S+)/;

/** Provider completion requests the mock has logged so far, optionally one kind. */
function mockRequestCount(kind?: string): number {
	const project = (() => {
		const projects = JSON.parse(
			execSync('docker compose ls --format json', { encoding: 'utf8' })
		) as Array<{ Name: string; ConfigFiles: string }>;
		const found = projects.find((p) => p.ConfigFiles.split(',').includes(COMPOSE_FILE));
		if (!found) throw new Error(`no running compose project mounts ${COMPOSE_FILE}`);
		return found;
	})();
	const logs = execSync(`docker logs ${project.Name}-mock-llm-1`, { encoding: 'utf8' });
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
		// part arrives.
		const live = page.locator('#msg-live-text');
		await expect(live).toContainText(IMAGE_REPLY_TEXT, { timeout: TURN_TIMEOUT });

		// Finalize: the live view closes and the placeholder was shown while
		// the image part was pending (the live view carries no base64).
		await expect(live).toHaveCount(0, { timeout: TURN_TIMEOUT });
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
		// the reply kind is.
		expect(mockRequestCount('image_reply')).toBe(repliesBefore + 1);

		// Reload: the redisplay is served from the persisted row — the
		// mock's request log must not grow at all.
		const totalAfterTurn = mockRequestCount();
		await page.reload();
		await expect(
			page.getByRole('button', { name: 'View image full size' }).locator('img')
		).toBeVisible({ timeout: TURN_TIMEOUT });
		expect(mockRequestCount()).toBe(totalAfterTurn);
	});
});
