export type ServerCap = 'stdio-mcp' | 'sandbox-db' | 'llm-proxy' | 'backup' | 'pg';
export interface HealthResponse {
	ok: true;
	version: string;
	caps: ServerCap[];
	sandboxDbPath?: string;
	restoring?: boolean;
}

export interface DbBatchStatement {
	sql: string;
	params?: unknown[];
}
export type DbQueryRequest =
	| { op: 'query'; sql: string; params?: unknown[] }
	| { op: 'batch'; stmts: DbBatchStatement[] }
	| { op: 'exec'; sql: string };
export interface DbQueryResult {
	columns: string[];
	rows: unknown[][];
}
export type DbQueryResponse =
	| DbQueryResult
	| { results: DbQueryResult[] }
	| { changes: number; lastInsertRowid: number | bigint | null };
export interface DbErrorResponse {
	error: string;
	detail?: string;
}

export interface McpSpawn {
	serverId: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
}
/**
 * Wire protocol frame kinds for the server stdio bridge.
 *
 * Client → server: `spawn`, `stdin`, `kill`
 * Server → client: `spawned`, `stdout`, `stderr`, `exit`
 */
export type McpFrameKind = 'spawn' | 'spawned' | 'stdin' | 'stdout' | 'stderr' | 'exit' | 'kill';
export interface LlmProxyRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

/**
 * GitHub Copilot server endpoints (016). The server runs the GitHub device
 * flow and mints session tokens; the browser never talks to github.com
 * directly. See `specs/016-github-copilot-support/contracts/copilot-server-api.md`.
 */
export type CopilotAuthStartRequest = Record<string, never>;
export interface CopilotAuthStartResponse {
	flowId: string;
	userCode: string;
	verificationUri: string;
	expiresAt: number;
	interval: number;
}
export interface CopilotAuthPollRequest {
	flowId: string;
}
/**
 * One poll of a device flow. `complete` is returned exactly once (the flow is
 * dropped afterwards); `slowDownAfter` appears only when GitHub said
 * `slow_down` (the new interval, in seconds).
 */
export type CopilotAuthPollResponse =
	| { status: 'pending' }
	| { status: 'pending'; slowDownAfter: number }
	| { status: 'complete'; githubToken: string; user: { login: string } }
	| { status: 'expired' }
	| { status: 'denied' };
export interface CopilotTokenRequest {
	githubToken: string;
}
export interface CopilotTokenResponse {
	token: string;
	expiresAt: number;
	endpoint: string;
	refreshInSeconds: number;
}
export type CopilotErrorCode = 'upstream' | 'unknown_flow' | 'grant_invalid' | 'not_entitled';
export interface CopilotErrorResponse {
	error: CopilotErrorCode;
	message?: string;
}

export interface McpFrame {
	serverId: string;
	kind: McpFrameKind;
	data?: string;
	code?: number;
	spawn?: McpSpawn;
}
