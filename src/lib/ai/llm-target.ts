/** True iff `url` parses and targets the local machine (localhost / 127.0.0.1 / ::1). */
export function isLoopbackUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
	} catch {
		return false;
	}
}

/**
 * Normalize a hostname for exact-match comparison: lowercase, strip the
 * trailing root dot, strip IPv6 brackets. Inputs are host names (no ports) —
 * callers pass `URL.hostname`, which already excludes the port.
 */
export function normalizeHostname(host: string): string {
	let normalized = host.trim().toLowerCase();
	if (normalized.startsWith('[') && normalized.endsWith(']')) {
		normalized = normalized.slice(1, -1);
	}
	while (normalized.endsWith('.')) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

/** Exact host equality after normalization — no subdomain wildcarding. */
export function sameHost(a: string, b: string): boolean {
	return normalizeHostname(a) === normalizeHostname(b);
}

/**
 * Normalized hostname of a parseable URL, or `undefined` when it does not
 * parse (032): credential producers use this to declare the host their
 * credentials target (`authHost`), and an unparseable URL omits the gate,
 * preserving the legacy attach-everywhere behavior.
 */
export function normalizeUrlHost(url: string): string | undefined {
	try {
		return normalizeHostname(new URL(url).hostname);
	} catch {
		return undefined;
	}
}
