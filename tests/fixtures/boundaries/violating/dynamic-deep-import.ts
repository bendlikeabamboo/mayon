// R2 fixture: dynamic deep import — the eslint gap this script closes.
export async function loadSchema() {
	return import('$lib/db/schema');
}
