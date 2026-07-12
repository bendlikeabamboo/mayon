export type ServerCap = 'stdio-mcp' | 'sandbox-db' | 'llm-proxy' | 'backup' | 'pg';
export interface HealthResponse {
	ok: true;
	version: string;
	caps: ServerCap[];
	sandboxDbPath?: string;
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

export interface McpFrame {
	serverId: string;
	kind: McpFrameKind;
	data?: string;
	code?: number;
	spawn?: McpSpawn;
}
