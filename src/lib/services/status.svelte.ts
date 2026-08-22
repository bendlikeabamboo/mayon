import type { ServerCap } from '@mayon/shared';

class ServerStatusState {
	connected = $state(false);
	caps = $state<ServerCap[]>([]);
	version = $state<string | null>(null);
	error = $state<string | null>(null);
	sandboxDbPath = $state<string | null>(null);
	restoring = $state(false);

	markConnected(h: {
		version: string;
		caps: ServerCap[];
		sandboxDbPath?: string;
		restoring?: boolean;
	}) {
		this.connected = true;
		this.caps = h.caps;
		this.version = h.version;
		this.sandboxDbPath = h.sandboxDbPath ?? null;
		this.restoring = h.restoring ?? false;
		this.error = null;
	}

	markDisconnected(err?: string) {
		this.connected = false;
		this.caps = [];
		this.version = null;
		this.sandboxDbPath = null;
		this.restoring = false;
		this.error = err ?? null;
	}

	has(cap: ServerCap) {
		return this.caps.includes(cap);
	}
}

export const serverStatus = new ServerStatusState();
