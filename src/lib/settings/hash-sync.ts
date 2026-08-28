const SELF_WRITE_GUARD_MS = 100;

export function sectionIdFromHash(hash: string): string | null {
	const id = hash.startsWith('#') ? hash.slice(1) : hash;
	return id === '' ? null : id;
}

export function sectionHash(pathname: string, id: string): string {
	return `${pathname}#${id}`;
}

export interface HashSync {
	pushJump(id: string): string | null;
	replaceActive(id: string): void;
	settle(id: string): void;
	onExternalHash(cb: (id: string | null) => void): () => void;
	initial(): string | null;
}

export class HashSyncCore {
	private settledId: string | null = null;
	private inFlightId: string | null = null;
	private lastSelfWriteAt = Number.NEGATIVE_INFINITY;

	push(id: string, now: number): boolean {
		if (this.inFlightId === id || this.settledId === id) return false;
		this.inFlightId = id;
		this.lastSelfWriteAt = now;
		return true;
	}

	replace(id: string, now: number): boolean {
		if (this.inFlightId !== null) return false;
		this.settledId = id;
		this.lastSelfWriteAt = now;
		return true;
	}

	settle(id: string): void {
		if (this.inFlightId !== null && this.inFlightId !== id) return;
		this.inFlightId = null;
		this.settledId = id;
	}

	land(id: string | null): void {
		this.inFlightId = null;
		this.settledId = id;
	}

	isExternal(now: number): boolean {
		return now - this.lastSelfWriteAt >= SELF_WRITE_GUARD_MS;
	}
}

export function createHashSync(getPathname: () => string): HashSync {
	const core = new HashSyncCore();

	return {
		pushJump(id: string): string | null {
			if (!core.push(id, Date.now())) return null;
			window.history.pushState({}, '', sectionHash(getPathname(), id));
			return id;
		},
		replaceActive(id: string): void {
			if (!core.replace(id, Date.now())) return;
			window.history.replaceState({}, '', sectionHash(getPathname(), id));
		},
		settle(id: string): void {
			core.settle(id);
		},
		onExternalHash(cb: (id: string | null) => void): () => void {
			const handler = () => {
				if (!core.isExternal(Date.now())) return;
				const id = sectionIdFromHash(window.location.hash);
				core.land(id);
				cb(id);
			};
			window.addEventListener('hashchange', handler);
			return () => window.removeEventListener('hashchange', handler);
		},
		initial(): string | null {
			return sectionIdFromHash(window.location.hash);
		}
	};
}
