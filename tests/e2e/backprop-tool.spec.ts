import { expect, test } from './fixtures/onboard';
import { EARLY_MARKER, PROPAGATE_TRIGGER } from './fixtures/kitchen-sink';
import { liveText } from './fixtures/render';
import type { Page } from '@playwright/test';

// The fixture chunks at 150ms per frame; a full turn (stream, tool round-trip
// with approval, continuation stream) settles well inside 30s.
const TURN_TIMEOUT = 30_000;

/**
 * Drive one real chat round trip and wait for the deterministic reply to
 * finish rendering.
 */
async function chatRoundTrip(page: Page): Promise<void> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Explain the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(liveText(page).first()).toContainText(EARLY_MARKER, {
		timeout: TURN_TIMEOUT
	});
	// The streamed kitchen-sink reply alone runs ~5s (150ms/frame); the turn
	// must fully settle (drain + persist) before the next send is safe.
	await expect(liveText(page)).toHaveCount(0, { timeout: TURN_TIMEOUT });
}

/**
 * Branch through the real UI affordance. The action row is hover-revealed
 * (opacity-0 + pointer-events-none until group-hover), so hover the message
 * container first or the click's hit-target check fails. A branch renders its
 * parent as a breadcrumb link; a root chat renders none, so the link is the
 * discriminator that navigation landed.
 */
async function branchFromLastMessage(page: Page): Promise<void> {
	const messageRow = page.locator('div[class~="group/message"]').filter({
		has: page.getByRole('button', { name: 'Branch a new chat from this whole message' })
	});
	await messageRow.hover();
	await messageRow
		.getByRole('button', { name: 'Branch a new chat from this whole message' })
		.click();
	await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('a')).toHaveCount(1, {
		timeout: TURN_TIMEOUT
	});
}

/** Root exchange → branch → one branch exchange (the tool's offered state). */
async function branchWithExchange(page: Page): Promise<void> {
	await chatRoundTrip(page);
	await branchFromLastMessage(page);
	await chatRoundTrip(page);
}

/**
 * Navigate to the parent via the breadcrumb, then scroll the transcript to
 * its end — far rows are unmounted (LazyMount), so assertions on rows near
 * the branch point only hold inside the scroll's mount margin.
 */
async function openParentViaBreadcrumb(page: Page): Promise<void> {
	await page.getByRole('navigation', { name: 'Breadcrumb' }).locator('a').click();
	await scrollTranscriptToEnd(page);
}

/** Pin every transcript scroller to its end (LazyMount's mount margin zone). */
async function scrollTranscriptToEnd(page: Page): Promise<void> {
	await page.locator('div.h-full.overflow-y-auto').evaluateAll((els) => {
		for (const el of els) el.scrollTop = el.scrollHeight;
	});
}

test.describe('conversational back-propagation tool (027 V6)', () => {
	// An explicit request IS the agreement, and it runs the same approval →
	// artifact path. Durable data/loop invariants (offer/decline/root end
	// states, row counts) are proven in src/lib/chat/backprop-endstate.test.ts.
	test('branch trigger streams a propagate_to_parent tool call; approval lands the artifact in the parent', async ({
		onboarded
	}) => {
		const { page } = onboarded;

		await branchWithExchange(page);

		// Trigger turn: the fixture dispatches a propagate_to_parent tool call.
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill(`I'm done here — ${PROPAGATE_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// Approval modal for the high-risk tool.
		const approve = page.getByRole('button', { name: 'Approve', exact: true });
		await expect(approve).toBeVisible({ timeout: TURN_TIMEOUT });
		await approve.click();

		// The tool call + result rows render as one grouped row (Succeeded
		// once the result lands), followed by the streamed continuation reply.
		await expect(page.getByText('propagate_to_parent')).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(page.getByText('Succeeded')).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(page.locator('.markdown-body', { hasText: EARLY_MARKER }).last()).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		await expect(liveText(page)).toHaveCount(0, { timeout: TURN_TIMEOUT });

		// The artifact anchors after the branch point in the parent.
		await openParentViaBreadcrumb(page);
		await expect(page.getByRole('button', { name: /Back-propagated from/ })).toBeVisible({
			timeout: TURN_TIMEOUT
		});
	});
});
