/**
 * Desktop-only passive auto-updater store.
 *
 * Mirrors the runes-store pattern of `db.svelte.ts` / `theme.svelte.ts`. On the
 * Tauri desktop shell it checks for updates (boot-debounced from the layout) and
 * exposes download/install/relaunch. In the browser build every method no-ops:
 * `!isTauri()` returns early, and the `@tauri-apps/plugin-updater` /
 * `plugin-process` modules are only ever dynamically imported inside
 * desktop-guarded methods, so they never enter the browser bundle.
 *
 * Release signing (`TAURI_SIGNING_PRIVATE_KEY` + password) is an env-gated
 * release concern (CI/docs), never handled here.
 */
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '$lib/db';

export type UpdaterStatus =
	| 'idle'
	| 'checking'
	| 'available'
	| 'not-available'
	| 'downloading'
	| 'installed'
	| 'error';

class UpdaterState {
	status = $state<UpdaterStatus>('idle');
	version = $state<string | null>(null);
	/** Download progress, 0..1. */
	progress = $state<number>(0);
	error = $state<string | null>(null);

	/** The pending `Update` resource captured by `check()`, desktop only. */
	#pending: Update | null = null;

	/** Check for an available update. No-op in the browser. */
	async check(): Promise<void> {
		if (!isTauri()) return;
		this.status = 'checking';
		this.error = null;
		try {
			const { check } = await import('@tauri-apps/plugin-updater');
			const update = await check();
			if (update) {
				this.#pending = update;
				this.version = update.version;
				this.status = 'available';
			} else {
				this.#pending = null;
				this.version = null;
				this.status = 'not-available';
			}
		} catch (err) {
			this.#pending = null;
			this.version = null;
			this.error = stringifyError(err);
			this.status = 'error';
		}
	}

	/** Download and install the pending update. No-op when there is none. */
	async downloadAndInstall(): Promise<void> {
		const update = this.#pending;
		if (!update) return;
		this.status = 'downloading';
		this.progress = 0;
		this.error = null;
		let downloaded = 0;
		let total = 0;
		try {
			await update.downloadAndInstall((event) => {
				switch (event.event) {
					case 'Started':
						total = event.data.contentLength ?? 0;
						this.progress = 0;
						break;
					case 'Progress':
						downloaded += event.data.chunkLength;
						this.progress = total > 0 ? Math.min(1, downloaded / total) : 0;
						break;
					case 'Finished':
						this.progress = 1;
						break;
				}
			});
			this.#pending = null;
			this.status = 'installed';
		} catch (err) {
			this.error = stringifyError(err);
			this.status = 'error';
		}
	}

	/** Relaunch the app after an installed update. No-op in the browser. */
	async relaunch(): Promise<void> {
		if (!isTauri()) return;
		const { relaunch } = await import('@tauri-apps/plugin-process');
		await relaunch();
	}
}

function stringifyError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export const updater = new UpdaterState();
