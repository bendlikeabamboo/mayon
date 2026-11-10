// Tier 2 MSW entry point: runs the service worker in the test browser.
import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
