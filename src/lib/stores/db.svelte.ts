export type DbStatusValue = 'initializing' | 'ready' | 'error';
export type DbRuntime = 'browser' | 'tauri' | 'memory' | 'pg' | 'unknown';
export type SelfCheckValue = 'pending' | 'pass' | 'fail';

class DbStatusState {
	status = $state<DbStatusValue>('initializing');
	runtime = $state<DbRuntime>('unknown');
	error = $state<string | null>(null);
	selfCheck = $state<SelfCheckValue>('pending');

	markReady(runtime: DbRuntime) {
		this.status = 'ready';
		this.runtime = runtime;
		this.error = null;
	}
	markError(message: string) {
		this.status = 'error';
		this.error = message;
	}
}

export const dbStatus = new DbStatusState();
