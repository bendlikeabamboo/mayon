export { FTS_BOOTSTRAP_SQL } from './fts';
export {
	SCHEMA_VERSION,
	LEGACY_VERSION,
	SCHEMA_VERSION_SETTINGS_KEY,
	planRestore
} from './schema-version';
export type { SchemaMigrationDescriptor, MigrationPlan } from './schema-version';
export type {
	ServerCap,
	HealthResponse,
	McpSpawn,
	McpFrameKind,
	McpFrame,
	LlmProxyRequest,
	DbBatchStatement,
	DbQueryRequest,
	DbQueryResult,
	DbQueryResponse,
	DbErrorResponse
} from './protocol';
