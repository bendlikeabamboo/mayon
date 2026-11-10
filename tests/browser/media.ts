/**
 * Test-only helper for the `setPointerMedia` browser command declared in
 * `vitest.browser.config.ts`. Chromium is the only configured browser, so the
 * CDP-backed command is always available here.
 */
import { commands } from 'vitest/browser';

interface MediaCommands {
	setPointerMedia(coarse: boolean | null): Promise<void>;
}

export function setPointerMedia(coarse: boolean | null): Promise<void> {
	return (commands as unknown as MediaCommands).setPointerMedia(coarse);
}
