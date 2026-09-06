/** True iff `url` parses and targets the local machine (localhost / 127.0.0.1 / ::1). */
export function isLoopbackUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
	} catch {
		return false;
	}
}
