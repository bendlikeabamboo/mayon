use rusqlite::{Connection, OpenFlags};
use std::fs;
use tauri::Manager;

const REQUIRED_TABLES: &[&str] = &[
	"chats",
	"messages",
	"branch_sources",
	"cross_links",
	"labs",
	"quizzes",
	"quiz_questions",
	"quiz_attempts",
	"quiz_answers",
	"agent_traces",
	"settings",
];

fn live_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
	Ok(app
		.path()
		.app_data_dir()
		.map_err(|e| e.to_string())?
		.join("mayon.db"))
}

#[tauri::command]
pub fn backup_database(app: tauri::AppHandle, target: String) -> Result<(), String> {
	if target.contains('\'') {
		return Err("Invalid backup path.".into());
	}
	let live = live_db_path(&app)?;
	let conn = Connection::open(&live).map_err(|e| e.to_string())?;
	let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
	conn.execute_batch(&format!("VACUUM INTO '{}'", target))
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_database(
	app: tauri::AppHandle,
	source: String,
	known_max: i64,
) -> Result<(), String> {
	let live = live_db_path(&app)?;

	let conn = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
		.map_err(|e| e.to_string())?;

	let tables: std::collections::HashSet<String> = {
		let mut stmt = conn
			.prepare("SELECT name FROM sqlite_master WHERE type='table'")
			.map_err(|e| e.to_string())?;
		let rows = stmt
			.query_map([], |r| r.get::<_, String>(0))
			.map_err(|e| e.to_string())?;
		let mut set = std::collections::HashSet::new();
		for row in rows {
			if let Ok(name) = row {
				set.insert(name);
			}
		}
		set
	};

	for t in REQUIRED_TABLES {
		if !tables.contains(*t) {
			return Err("Backup is missing required tables.".into());
		}
	}

	let max_applied: Option<i64> = conn
		.query_row("SELECT MAX(created_at) FROM __drizzle_migrations", [], |r| r.get(0))
		.ok();

	if let Some(m) = max_applied {
		if m > known_max {
			return Err("Backup is from a newer app version.".into());
		}
	}
	drop(conn);

	let safety = live.with_file_name("mayon-pre-restore.db");
	fs::copy(&live, &safety).map_err(|e| e.to_string())?;

	fs::copy(&source, &live).map_err(|e| e.to_string())?;
	let _ = fs::remove_file(format!("{}-wal", live.display()));
	let _ = fs::remove_file(format!("{}-shm", live.display()));

	Ok(())
}
