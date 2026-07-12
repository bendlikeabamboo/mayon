import type { HealthResponse } from '@mayon/shared';

export async function detectSidecar(): Promise<HealthResponse | null> {
	try {
		const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
		if (!res.ok) return null;
		const body = (await res.json()) as HealthResponse;
		return body && body.ok ? body : null;
	} catch {
		return null;
	}
}
