import type { HealthResponse } from '@mayon/shared';

export async function detectServer(): Promise<HealthResponse | null> {
	try {
		const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
		if (!res.ok) return null;
		const body = (await res.json()) as HealthResponse;
		return body && body.ok ? body : null;
	} catch {
		return null;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export async function waitForServerPg(opts?: {
	attempts?: number;
	delayMs?: number;
}): Promise<HealthResponse | null> {
	const attempts = opts?.attempts ?? 10;
	const delayMs = opts?.delayMs ?? 2000;
	for (let i = 0; i < attempts; i++) {
		const h = await detectServer();
		if (h && h.ok && h.caps.includes('pg')) return h;
		if (i < attempts - 1) await sleep(delayMs);
	}
	return null;
}
