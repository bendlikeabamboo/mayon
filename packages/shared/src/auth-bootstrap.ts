export const AUTH_BOOTSTRAP_SQL: string[] = [
	'CREATE INDEX IF NOT EXISTS auth_login_attempts_source_at_idx ON auth_login_attempts (source, at);',
	'CREATE INDEX IF NOT EXISTS auth_identities_status_idx ON auth_identities (status);',
	'CREATE INDEX IF NOT EXISTS auth_sessions_identity_id_idx ON auth_sessions (identity_id);'
];
