import type { TelemetryCaptureMode, TelemetryConfig } from '@mayon/shared';
import { repos } from '#lib/db/index.js';

const TELEMETRY_KEY = 'telemetry';

const DISABLED_DEFAULT: TelemetryConfig = {
	enabled: false,
	host: '',
	publicKey: '',
	captureMode: 'content',
	updatedAt: ''
};

/** Fail-closed read of the settings KV row: anything but a valid shape ⇒ disabled (FR-001). */
function asConfig(row: unknown): TelemetryConfig {
	if (typeof row !== 'object' || row === null) return DISABLED_DEFAULT;
	const c = row as Record<string, unknown>;
	if (
		typeof c.enabled !== 'boolean' ||
		typeof c.host !== 'string' ||
		typeof c.publicKey !== 'string' ||
		(c.captureMode !== 'content' && c.captureMode !== 'metadata')
	) {
		return DISABLED_DEFAULT;
	}
	return row as TelemetryConfig;
}

/** Reactive telemetry config state — the synchronous gate behind `emitTelemetry` (FR-002). */
class TelemetryState {
	enabled = $state(false);
	host = $state('');
	publicKey = $state('');
	captureMode = $state<TelemetryCaptureMode>('content');

	applyConfig(config: TelemetryConfig): void {
		this.enabled = config.enabled;
		this.host = config.host;
		this.publicKey = config.publicKey;
		this.captureMode = config.captureMode;
	}

	/** Boot init: read the `telemetry` settings KV row; absent/corrupt ⇒ disabled defaults. */
	async init(): Promise<void> {
		try {
			const row = await repos.settings.get<unknown>(TELEMETRY_KEY);
			this.applyConfig(row === null ? DISABLED_DEFAULT : asConfig(row));
		} catch {
			this.applyConfig(DISABLED_DEFAULT);
		}
	}
}

export const telemetryState = new TelemetryState();
