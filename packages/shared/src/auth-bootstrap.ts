export const AUTH_BOOTSTRAP_SQL: string[] = [
	'CREATE INDEX IF NOT EXISTS auth_login_attempts_source_at_idx ON auth_login_attempts (source, at);'
];
