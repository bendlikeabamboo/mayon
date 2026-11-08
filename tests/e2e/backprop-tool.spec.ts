import { expect, test } from './fixtures/onboard';
import {
	EARLY_MARKER,
	PROPAGATE_TRIGGER,
	PROPAGATE_UNAVAILABLE_REPLY
} from './fixtures/kitchen-sink';
import type { Page } from '@playwright/test';

// The fixture chunks at 150ms per frame; a full turn (stream, tool round-trip
// with approval, continuation stream) settles well inside 30s.
const TURN_TIMEOUT = 30_000;

// Live window for scenario B's "no approval modal ever" check: the trigger
// turn (two streamed frames + drain + persist) settles well inside it.
const MODAL_WINDOW = 12_000;

/**
 * Drive one real chat round trip and wait for the deterministic reply to
 * finish rendering (same journey as tests/e2e/mock-classification.spec.ts).
 */
async function chatRoundTrip(page: Page): Promise<void> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Explain the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.locator('#msg-live-text')).toContainText(EARLY_MARKER, {
		timeout: TURN_TIMEOUT
	});
	// The streamed kitchen-sink reply alone runs ~5s (150ms/frame); the turn
	// must fully settle (drain + persist) before the next send is safe.
	await expect(page.locator('#msg-live-text')).toHaveCount(0, { timeout: TURN_TIMEOUT });
}

test.describe('conversational back-propagation tool (027 V6)', () => {
	test('branch trigger streams a propagate_to_parent tool call; approval lands the artifact in the parent', async ({
		onboarded
	}) => {
		const { page } = onboarded;

		// The root needs one exchange first so the branch has a branch point.
		await chatRoundTrip(page);

		// Branch through the real UI affordance. The action row is hover-revealed
		// (opacity-0 + pointer-events-none until group-hover), so hover the
		// message container first or the click's hit-target check fails.
		const messageRow = page.locator('div[class~="group/message"]').filter({
			has: page.getByRole('button', { name: 'Branch a new chat from this whole message' })
		});
		await messageRow.hover();
		await messageRow
			.getByRole('button', { name: 'Branch a new chat from this whole message' })
			.click();
		// A branch renders its parent as a breadcrumb link; a root chat renders
		// none, so the link is the discriminator that navigation landed.
		await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('a')).toHaveCount(1, {
			timeout: TURN_TIMEOUT
		});

		// A fresh branch has no own rows yet, and the tool is only offered to a
		// branch with messages (quickstart V4) — give it one exchange.
		await chatRoundTrip(page);

		// Trigger turn: the fixture dispatches a propagate_to_parent tool call.
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill(`I'm done here — ${PROPAGATE_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// Approval modal for the high-risk tool; the tool path fires no toast.
		const approve = page.getByRole('button', { name: 'Approve', exact: true });
		await expect(approve).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(page.locator('[aria-label="Dismiss"]')).toHaveCount(0);
		await approve.click();

		// (1) Branch timeline: the tool call + result rows render as one
		// grouped row (Succeeded once the result lands), followed by the
		// streamed continuation reply.
		await expect(page.getByText('propagate_to_parent')).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(page.getByText('Succeeded')).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(page.locator('.markdown-body', { hasText: EARLY_MARKER }).last()).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		await expect(page.locator('#msg-live-text')).toHaveCount(0, { timeout: TURN_TIMEOUT });

		// (4) No toast ever fired on the tool path (turn fully settled).
		await expect(page.locator('[aria-label="Dismiss"]')).toHaveCount(0);

		// (2) Navigate to the parent via the breadcrumb; the artifact anchors
		// after the branch point. Far timeline rows are unmounted (LazyMount),
		// so scroll the transcript to its end before asserting.
		await page.getByRole('navigation', { name: 'Breadcrumb' }).locator('a').click();
		await page.locator('div.h-full.overflow-y-auto').evaluateAll((els) => {
			for (const el of els) el.scrollTop = el.scrollHeight;
		});
		await expect(page.getByRole('button', { name: /Back-propagated from/ })).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		await expect(page.locator('[aria-label="Dismiss"]')).toHaveCount(0);
	});

	test('root trigger never offers propagation and points at the manual control', async ({
		onboarded
	}) => {
		const { page } = onboarded;

		// First root turn has tools disabled; the second carries the tool set
		// minus propagate_to_parent (roots are excluded — FR-001).
		await chatRoundTrip(page);
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill(`Wrap up — ${PROPAGATE_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// The reply names the manual back-propagate control (propagate_unavailable
		// fixture kind). Bounded live window first: an approval modal must never
		// appear while the turn runs (a mid-turn modal would surface here).
		const modal = page.getByText('Approval required');
		const modalAppeared = await modal.waitFor({ state: 'visible', timeout: MODAL_WINDOW }).then(
			() => true,
			() => false
		);
		expect(modalAppeared).toBe(false);
		await expect(page.locator('[aria-label="Dismiss"]')).toHaveCount(0);

		// The app's boot gate can hard-reload mid-turn on a transient server
		// blip, orphaning committed-but-unrendered rows from the live DOM. The
		// persisted transcript is the source of truth for the final assertions.
		await page.reload();
		await expect(
			page.locator('.markdown-body', { hasText: PROPAGATE_UNAVAILABLE_REPLY })
		).toBeVisible({ timeout: TURN_TIMEOUT });
		// An undecided durable ask row survives the reload — its absence is the
		// end-state no-approval assertion.
		await expect(page.getByText('Approval required')).toHaveCount(0);
		await expect(page.locator('[aria-label="Dismiss"]')).toHaveCount(0);
	});
});
