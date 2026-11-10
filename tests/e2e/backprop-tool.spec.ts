import { expect, test } from './fixtures/onboard';
import {
	EARLY_MARKER,
	OFFER_REPLY,
	OFFER_TRIGGER,
	PROPAGATE_TRIGGER,
	PROPAGATE_UNAVAILABLE_REPLY
} from './fixtures/kitchen-sink';
import { liveText } from './fixtures/render';
import type { Page } from '@playwright/test';

// The fixture chunks at 150ms per frame; a full turn (stream, tool round-trip
// with approval, continuation stream) settles well inside 30s.
const TURN_TIMEOUT = 30_000;

/**
 * Drive one real chat round trip and wait for the deterministic reply to
 * finish rendering (same journey as tests/e2e/mock-classification.spec.ts).
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
	// US2 "agreement → propagation executes" is covered by the first test
	// below: an explicit request IS the agreement, and it runs the same
	// approval → artifact path — no separate scenario (no duplication).
	// Durable data/loop invariants (row counts, ask/toast absence sweeps)
	// are proven in src/lib/chat/backprop-endstate.test.ts (031 parity).
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

	test('completion signal gets one plain offer and never propagates', async ({ onboarded }) => {
		const { page } = onboarded;

		await branchWithExchange(page);

		// Offer turn: the fixture answers with the deterministic plain-text
		// offer (manual control + explicit ask) — never a tool call.
		const composer = page.getByPlaceholder(/Message the active provider/);
		const rowsBefore = await page.locator('div[id^="msg-"]:not([id^="msg-live"])').count();
		await composer.fill(`Wrapping up — ${OFFER_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// The offer streams as one fast frame, so the streaming autoscroll
		// never runs and the committed reply row can stay below the fold,
		// outside LazyMount's mount margin. Wait for the turn to settle (both
		// durable rows commit — the turn-spanning reload mitigation), then
		// scroll the reply into its mount zone.
		await expect(page.locator('div[id^="msg-"]:not([id^="msg-live"])')).toHaveCount(
			rowsBefore + 2,
			{ timeout: TURN_TIMEOUT }
		);
		await scrollTranscriptToEnd(page);
		await expect(page.locator('.markdown-body', { hasText: OFFER_REPLY })).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		await expect(liveText(page)).toHaveCount(0, { timeout: TURN_TIMEOUT });

		// The app's boot gate can hard-reload mid-turn on a transient server
		// blip; the persisted transcript is the source of truth for the
		// end-state assertions (same pattern as the root-control test).
		await page.reload();
		await expect(page.locator('.markdown-body', { hasText: OFFER_REPLY })).toBeVisible({
			timeout: TURN_TIMEOUT
		});
	});

	test('declined propagation never runs and is never re-requested', async ({ onboarded }) => {
		const { page } = onboarded;

		await branchWithExchange(page);

		// Trigger turn, then decline the approval ask.
		const composer = page.getByPlaceholder(/Message the active provider/);
		await composer.fill(`I'm done here — ${PROPAGATE_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();
		const approve = page.getByRole('button', { name: 'Approve', exact: true });
		await expect(approve).toBeVisible({ timeout: TURN_TIMEOUT });
		await page.getByRole('button', { name: 'Decline', exact: true }).click();

		// The live ask collapses into its durable rows: the tool group renders
		// the Declined badge (the declined tool_result, summary 'user
		// declined') and the ask row's decision chip reads declined.
		await expect(page.getByText('Declined', { exact: true })).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		await expect(page.getByText('declined', { exact: true })).toBeVisible({
			timeout: TURN_TIMEOUT
		});

		// The turn continues: the declined result ends the tool path and the
		// continuation streams as a plain chat reply.
		await expect(page.locator('.markdown-body', { hasText: EARLY_MARKER }).last()).toBeVisible({
			timeout: TURN_TIMEOUT
		});
		await expect(liveText(page)).toHaveCount(0, { timeout: TURN_TIMEOUT });

		// Persisted transcript after a reload: the decided rows stay decided.
		// The transcript ends on the streamed continuation (bottom rows mount
		// on load); the declined tool/ask rows sit far above LazyMount's mount
		// margin, so their durable state is asserted against the live DOM
		// above.
		await page.reload();
		await expect(page.locator('.markdown-body', { hasText: EARLY_MARKER }).last()).toBeVisible({
			timeout: TURN_TIMEOUT
		});
	});

	test('root trigger never offers propagation and points at the manual control', async ({
		onboarded
	}) => {
		const { page } = onboarded;

		// First root turn has tools disabled; the second carries the tool set
		// minus propagate_to_parent (roots are excluded — FR-001).
		await chatRoundTrip(page);
		const composer = page.getByPlaceholder(/Message the active provider/);
		const rowsBefore = await page.locator('div[id^="msg-"]:not([id^="msg-live"])').count();
		await composer.fill(`Wrap up — ${PROPAGATE_TRIGGER}.`);
		await page.getByRole('button', { name: 'Send', exact: true }).click();

		// Settle before any reload: the reply row persists only when the loop
		// finished, so reaching it proves the turn ran to completion —
		// reloading earlier (slow CI runner) aborts the turn mid-flight and
		// the persisted transcript would never contain the reply
		// (turn-spanning reload mitigation).
		await expect(page.locator('div[id^="msg-"]:not([id^="msg-live"])')).toHaveCount(
			rowsBefore + 2,
			{ timeout: TURN_TIMEOUT }
		);

		// The persisted transcript is the source of truth: a CI server blip can
		// still fire the boot gate's (streaming-deferred) reload near the turn's
		// tail, so the end state is asserted after an explicit reload rather
		// than trusting the mid-air DOM.
		await page.reload();
		await scrollTranscriptToEnd(page);
		await expect(
			page.locator('.markdown-body', { hasText: PROPAGATE_UNAVAILABLE_REPLY })
		).toBeVisible({ timeout: TURN_TIMEOUT });
		await expect(liveText(page)).toHaveCount(0, { timeout: TURN_TIMEOUT });
	});
});
