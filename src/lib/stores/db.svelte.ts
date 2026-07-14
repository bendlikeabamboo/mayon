export type DbStatusValue = 'initializing' | 'ready' | 'error';
export type DbRuntime = 'browser' | 'tauri' | 'memory' | 'pg' | 'unknown';
export type SelfCheckValue = 'pending' | 'pass' | 'fail';
export type DbErrorReason = 'server-unreachable' | 'generic';

class DbStatusState {
	status = $state<DbStatusValue>('initializing');
	runtime = $state<DbRuntime>('unknown');
	error = $state<string | null>(null);
	reason = $state<DbErrorReason | null>(null);
	selfCheck = $state<SelfCheckValue>('pending');

	markReady(runtime: DbRuntime) {
		this.status = 'ready';
		this.runtime = runtime;
		this.error = null;
		this.reason = null;
	}
	markError(message: string, reason: DbErrorReason = 'generic') {
		this.status = 'error';
		this.error = message;
		this.reason = reason;
	}
}

export const dbStatus = new DbStatusState();
