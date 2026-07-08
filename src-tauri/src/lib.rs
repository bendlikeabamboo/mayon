mod backup;
mod keys;
mod mcp;
mod transport;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let builder = tauri::Builder::default();

	#[cfg(desktop)]
	let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
		if let Some(w) = app.get_webview_window("main") {
			let _ = w.show();
			let _ = w.set_focus();
		}
	}));

	builder
		.plugin(tauri_plugin_sql::Builder::default().build())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.manage(transport::StreamHandles::default())
		.manage(mcp::McpHandles::default())
		.setup(|app| {
			if cfg!(debug_assertions) {
				app.handle().plugin(
					tauri_plugin_log::Builder::default()
						.level(log::LevelFilter::Info)
						.build(),
				)?;
			}
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			keys::key_set,
			keys::key_has,
			keys::key_delete,
			transport::llm_stream,
			transport::llm_stream_cancel,
			mcp::mcp_spawn,
			mcp::mcp_call,
			mcp::mcp_notify,
			mcp::mcp_respond,
			mcp::mcp_close,
			backup::backup_database,
			backup::restore_database,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
