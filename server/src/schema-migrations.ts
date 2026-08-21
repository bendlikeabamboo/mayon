import type { PgPoolClient } from './pg';
import { SCHEMA_VERSION, type SchemaMigrationDescriptor } from '@mayon/shared';

export interface ServerSchemaMigration extends SchemaMigrationDescriptor {
	hasMigrate: boolean;
	migrate?(client: PgPoolClient): Promise<void>;
}

async function backfillKinds(client: PgPoolClient): Promise<void> {
	await client.query(`
		UPDATE messages SET kind = 'user_message'
		WHERE kind IS NULL AND role = 'user'
	`);

	await client.query(`
		UPDATE messages SET kind = 'choices'
		WHERE kind IS NULL
		  AND role = 'assistant'
		  AND tool_call_id IS NOT NULL
		  AND tool_name = 'present_choices'
	`);

	await client.query(`
		UPDATE messages SET kind = 'tool_call'
		WHERE kind IS NULL
		  AND role = 'assistant'
		  AND tool_call_id IS NOT NULL
	`);

	await client.query(`
		UPDATE messages SET kind = 'tool_result'
		WHERE kind IS NULL
		  AND role = 'tool'
		  AND tool_name = 'present_choices'
	`);

	await client.query(`
		UPDATE messages SET kind = 'tool_result'
		WHERE kind IS NULL
		  AND role = 'tool'
	`);

	await client.query(`
		UPDATE messages SET kind = 'assistant_message'
		WHERE kind IS NULL
		  AND role = 'assistant'
		  AND tool_call_id IS NULL
	`);

	await client.query(`
		UPDATE messages SET kind = 'assistant_message'
		WHERE kind IS NULL
		  AND role = 'system'
	`);

	const { rows } = await client.query(`SELECT count(*)::int AS n FROM messages WHERE kind IS NULL`);
	const unclassified = Number(rows[0]?.n ?? 0);
	if (unclassified > 0) {
		throw new Error(
			`schema migration 1→2: ${unclassified} message(s) could not be classified by the D10 case table — refusing to continue (FR-013)`
		);
	}

	await client.query(`ALTER TABLE messages ALTER COLUMN kind SET NOT NULL`);
}

export const SCHEMA_MIGRATIONS: ServerSchemaMigration[] = [
	{
		from: 1,
		to: 2,
		description: 'add messages.kind + backfill from legacy column combos',
		kind: 'additive',
		hasMigrate: true,
		migrate: backfillKinds
	}
];

export function registryDescriptors(): SchemaMigrationDescriptor[] {
	return SCHEMA_MIGRATIONS.map(({ from, to, description, kind, hasMigrate }) => ({
		from,
		to,
		description,
		kind,
		hasMigrate
	}));
}

export async function runSchemaDataMigrations(
	pool: PgPoolLike,
	currentStamp: number
): Promise<string[]> {
	const pending = SCHEMA_MIGRATIONS.filter(
		(m) => m.from >= currentStamp && m.to <= SCHEMA_VERSION
	).sort((a, b) => a.to - b.to);
	const applied: string[] = [];
	for (const mig of pending) {
		if (!mig.migrate) continue;
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			try {
				await mig.migrate(client);
				await client.query('COMMIT');
				applied.push(`${mig.from}→${mig.to}: ${mig.description}`);
			} catch (migErr) {
				await client.query('ROLLBACK').catch(() => {});
				throw migErr;
			}
		} finally {
			client.release();
		}
	}
	return applied;
}

export { SCHEMA_VERSION };
