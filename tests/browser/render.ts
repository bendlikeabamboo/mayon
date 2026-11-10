/**
 * Thin wrapper around `vitest-browser-svelte`'s `render`.
 *
 * Importing this module registers an automatic `afterEach(cleanup)`, so each
 * test starts from an empty document. Query the rendered component through
 * accessible roles (`getByRole`) or explicit test ids (`getByTestId`) — never
 * source text, class names, or markup structure.
 */
import { afterEach } from 'vitest';
import { cleanup, render as renderComponent } from 'vitest-browser-svelte';

afterEach(cleanup);

export { renderComponent as render };
export type {
	Component,
	ComponentImport,
	ComponentOptions,
	RenderResult,
	Rerender,
	SetupOptions
} from 'vitest-browser-svelte';
