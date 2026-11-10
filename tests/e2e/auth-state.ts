import path from 'node:path';

/** Generated Playwright storage state; `test-results/` is gitignored. */
export const AUTH_STATE_FILE = 'test-results/.auth/state.json';

/** Absolute path for setup/global-setup I/O. */
export const AUTH_STATE_PATH = path.resolve(process.cwd(), AUTH_STATE_FILE);
