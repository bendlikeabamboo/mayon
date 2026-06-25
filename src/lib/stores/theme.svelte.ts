export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'mayon.theme';

function systemDark(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme) {
	if (typeof document === 'undefined') return;
	const dark = theme === 'dark' || (theme === 'system' && systemDark());
	document.documentElement.classList.toggle('dark', dark);
}

class ThemeState {
	preference = $state<Theme>('system');

	constructor() {
		if (typeof window === 'undefined') return;
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
		this.preference = stored ?? 'system';
		applyTheme(this.preference);
		// Keep "system" in sync with the OS preference.
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (this.preference === 'system') applyTheme('system');
		});
	}

	get resolved(): 'light' | 'dark' {
		return this.preference === 'system' ? (systemDark() ? 'dark' : 'light') : this.preference;
	}

	set(theme: Theme) {
		this.preference = theme;
		localStorage.setItem(STORAGE_KEY, theme);
		applyTheme(theme);
		// Task 6 mirrors this into the settings KV (durable source of truth).
		void settingsSyncHook?.(theme);
	}

	/** Apply a value read from the settings KV (durable) without writing back to it. */
	hydrate(theme: Theme) {
		this.preference = theme;
		localStorage.setItem(STORAGE_KEY, theme);
		applyTheme(theme);
	}
}

/** Set by the settings repository (Task 6) to mirror theme into the DB. */
export let settingsSyncHook: ((theme: Theme) => void | Promise<void>) | null = null;
export function bindThemePersistence(fn: (theme: Theme) => void | Promise<void>) {
	settingsSyncHook = fn;
}

export const themeState = new ThemeState();
