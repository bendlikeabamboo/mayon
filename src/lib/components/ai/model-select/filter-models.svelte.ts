export interface FilterResult {
	items: string[];
}

export function filterModels(models: string[], value: string, query: string): FilterResult {
	const q = query.trim().toLowerCase();
	let pool: string[];

	if (value && !models.includes(value)) {
		pool = [value, ...models];
	} else {
		pool = [...models];
	}

	if (!q) return { items: pool };

	const activeValue = value && !models.includes(value) ? value : null;
	const filtered = pool.filter((m) => {
		if (activeValue && m === activeValue) return true;
		return m.toLowerCase().includes(q);
	});

	return { items: filtered };
}
