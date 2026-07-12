import type { SidecarCap } from '@mayon/shared';

class SidecarStatusState {
	connected = $state(false);
	caps = $state<SidecarCap[]>([]);
	version = $state<string | null>(null);
	error = $state<string | null>(null);
	sandboxDbPath = $state<string | null>(null);

	markConnected(h: { version: string; caps: SidecarCap[]; sandboxDbPath?: string }) {
		this.connected = true;
		this.caps = h.caps;
		this.version = h.version;
		this.sandboxDbPath = h.sandboxDbPath ?? null;
		this.error = null;
	}

	markDisconnected(err?: string) {
		this.connected = false;
		this.caps = [];
		this.version = null;
		this.sandboxDbPath = null;
		this.error = err ?? null;
	}

	has(cap: SidecarCap) {
		return this.caps.includes(cap);
	}
}

export const sidecarStatus = new SidecarStatusState();
