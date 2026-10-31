import type { TelemetryEventRecord } from '@mayon/shared';
import { serverClient } from '#lib/services/client.js';
import { telemetryState } from './state.svelte';

const BUFFER_BOUND = 50;
const WINDOW_MS = 5000;

let buffer: TelemetryEventRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function dropDisabled(): boolean {
	if (telemetryState.enabled) return false;
	buffer = [];
	return true;
}

function schedule(): void {
	if (timer) return;
	timer = setTimeout(() => {
		timer = null;
		void flush();
	}, WINDOW_MS);
}

async function flush(): Promise<void> {
	if (dropDisabled()) return;
	if (buffer.length === 0) return;
	const batch = buffer.slice(0, BUFFER_BOUND);
	buffer = buffer.slice(batch.length);
	try {
		await serverClient.http('/api/telemetry/events', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ records: batch })
		});
	} catch {
		// Retry next window; the bound below is the backstop.
		buffer = [...batch, ...buffer];
		if (buffer.length > BUFFER_BOUND) {
			buffer.splice(0, buffer.length - BUFFER_BOUND);
		}
		schedule();
	}
}

/**
 * Fire-and-forget handoff from capture: buffers the record and POSTs the
 * batch same-origin within ≤5s or at 50 records, whichever first. Swallows
 * every error — telemetry must never block or throw into the chat path.
 */
export function relayTelemetry(record: TelemetryEventRecord): void {
	if (dropDisabled()) return;
	buffer.push(record);
	if (buffer.length > BUFFER_BOUND) {
		buffer.splice(0, buffer.length - BUFFER_BOUND);
	}
	if (buffer.length >= BUFFER_BOUND) {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		void flush();
		return;
	}
	schedule();
}
