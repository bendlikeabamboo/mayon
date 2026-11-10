// Tier 1 MSW entry point: intercepts fetch/XMLHttpRequest in the Node process.
import { setupServer } from 'msw/node';

import { handlers } from './handlers';

export const server = setupServer(...handlers);
