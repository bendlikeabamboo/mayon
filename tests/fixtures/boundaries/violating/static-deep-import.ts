// R1 fixture: static deep import of a '$lib/db' internal. Live code is also
// rejected by eslint; this tree exercises the script backstop.
import { bootstrapDb } from '$lib/db/driver/client';
