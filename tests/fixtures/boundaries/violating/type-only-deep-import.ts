// R1 fixture: type-only deep import — rejected by eslint in live code and by
// the script backstop; no type-import exception exists.
import type { Message } from '$lib/db/schema';
