import type { PgPoolClient } from './pg';
import { SCHEMA_VERSION, type SchemaMigrationDescriptor } from '@mayon/shared';

export interface ServerSchemaMigration extends SchemaMigrationDescriptor {
	hasMigrate: boolean;
	migrate?(client: PgPoolClient): Promise<void>;
}

export const SCHEMA_MIGRATIONS: ServerSchemaMigration[] = [];

export function registryDescriptors(): SchemaMigrationDescriptor[] {
	return SCHEMA_MIGRATIONS.map(({ from, to, description, kind, hasMigrate }) => ({
		from,
		to,
		description,
		kind,
		hasMigrate
	}));
}

export { SCHEMA_VERSION };
