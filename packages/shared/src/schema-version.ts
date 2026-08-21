export const SCHEMA_VERSION = 2;
export const LEGACY_VERSION = 0;
export const SCHEMA_VERSION_SETTINGS_KEY = 'schemaVersion';

export interface SchemaMigrationDescriptor {
	from: number;
	to: number;
	description: string;
	kind: 'additive' | 'breaking';
	hasMigrate?: boolean;
}

export interface MigrationPlan {
	decision: 'proceed' | 'refuse-newer' | 'refuse-breaking';
	migrations: SchemaMigrationDescriptor[];
	notice: string;
	dumpVersion: number;
	currentVersion: number;
}

export function planRestore(
	dumpVersion: number,
	currentVersion: number,
	registry: SchemaMigrationDescriptor[]
): MigrationPlan {
	if (dumpVersion > currentVersion) {
		return {
			decision: 'refuse-newer',
			migrations: [],
			notice: `backup is from a newer schema (v${dumpVersion}) than this server (v${currentVersion}); upgrade Mayon first`,
			dumpVersion,
			currentVersion
		};
	}

	const migrations = registry
		.filter((m) => m.from >= dumpVersion && m.from < currentVersion)
		.sort((a, b) => a.to - b.to);

	const breakingNoMigrate = migrations.find((m) => m.kind === 'breaking' && !m.hasMigrate);
	if (breakingNoMigrate) {
		return {
			decision: 'refuse-breaking',
			migrations: [],
			notice: `backup requires a breaking migration (v${breakingNoMigrate.from} \u2192 v${breakingNoMigrate.to}: ${breakingNoMigrate.description}) with no automatic migration; upgrade Mayon first`,
			dumpVersion,
			currentVersion
		};
	}

	const breakingCount = migrations.filter((m) => m.kind === 'breaking').length;
	const additiveCount = migrations.filter((m) => m.kind === 'additive').length;

	let notice: string;
	if (dumpVersion === LEGACY_VERSION) {
		notice = 'legacy backup (no schema version stamp) \u2014 restoring into current schema';
		if (migrations.length > 0) {
			notice += `; ${migrations.length} migration(s) will be applied`;
		}
	} else if (migrations.length === 0) {
		notice = `restoring from schema v${dumpVersion} (current v${currentVersion}); no migrations needed`;
	} else {
		notice = `restoring from schema v${dumpVersion} \u2192 v${currentVersion}`;
		if (breakingCount > 0) {
			notice += `; ${breakingCount} breaking migration(s) and ${additiveCount} additive gap(s) will be applied`;
		} else {
			notice += `; ${additiveCount} additive gap(s) auto-filled`;
		}
	}

	return {
		decision: 'proceed',
		migrations,
		notice,
		dumpVersion,
		currentVersion
	};
}
