//! Desktop MCP stdio subprocess pool.
//!
//! Manages MCP server subprocesses spawned as child processes. Each child
//! communicates via newline-delimited JSON-RPC over stdin/stdout. The Rust
//! side owns the process lifetime, framing, and keychain secret resolution.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

/// Managed state: spawned MCP server children keyed by server_id.
#[derive(Default)]
pub struct McpHandles(
	pub std::sync::Mutex<HashMap<String, Arc<Mutex<McpChild>>>>,
);

pub struct McpChild {
	child: Child,
	stdin: tokio::process::ChildStdin,
	reader_handle: Option<tauri::async_runtime::JoinHandle<()>>,
	pending: Arc<Mutex<HashMap<i64, oneshot::Sender<serde_json::Value>>>>,
	next_id: Mutex<i64>,
	server_id: String,
}

/// Env var key injection descriptor from JS. Secret resolved from OS keychain.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvKeyRef {
	name: String,
	key_id: String,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
enum McpEvent {
	Notification {
		server_id: String,
		method: String,
		params: serde_json::Value,
	},
}

#[tauri::command]
pub async fn mcp_spawn(
	app: AppHandle,
	state: State<'_, McpHandles>,
	server_id: String,
	command: String,
	args: Vec<String>,
	env_key_ids: Vec<EnvKeyRef>,
	cwd: Option<String>,
) -> Result<(), String> {
	if !Path::new(&command).is_absolute() {
		log::warn!(
			"MCP command '{}' is not an absolute path (PATH lookup)",
			command
		);
	}

	let mut cmd = Command::new(&command);
	cmd.args(&args)
		.stdin(std::process::Stdio::piped())
		.stdout(std::process::Stdio::piped())
		.stderr(std::process::Stdio::inherit());

	if let Some(ref dir) = cwd {
		cmd.current_dir(dir);
	}

	for ref ek in &env_key_ids {
		let entry =
			keyring::Entry::new("Mayon", &ek.key_id).map_err(|e| e.to_string())?;
		let secret = entry.get_password().map_err(|e| e.to_string())?;
		cmd.env(&ek.name, secret);
	}

	let mut child = cmd
		.spawn()
		.map_err(|e| format!("failed to spawn MCP server: {e}"))?;
	let stdin = child.stdin.take().ok_or("failed to get stdin")?;
	let stdout = child.stdout.take().ok_or("failed to get stdout")?;

	let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<serde_json::Value>>>> =
		Arc::new(Mutex::new(HashMap::new()));
	let pending_clone = pending.clone();
	let server_id_clone = server_id.clone();
	let app_clone = app.clone();

	let reader_handle = tauri::async_runtime::spawn(async move {
		let reader = BufReader::new(stdout);
		let mut lines = reader.lines();
		while let Ok(Some(line)) = lines.next_line().await {
			let trimmed = line.trim().to_string();
			if trimmed.is_empty() {
				continue;
			}
			if let Ok(value) = serde_json::from_str::<serde_json::Value>(&trimmed) {
				if let Some(id) = value.get("id").and_then(|v| v.as_i64()) {
					if let Some(tx) = pending_clone.lock().await.remove(&id) {
						let _ = tx.send(value);
					} else if value.get("method").is_some() {
						let method = value
							.get("method")
							.and_then(|v| v.as_str())
							.unwrap_or("")
							.to_string();
						let params = value
							.get("params")
							.cloned()
							.unwrap_or(serde_json::Value::Null);
						let _ = app_clone.emit(
							&format!("mcp-request:{}", server_id_clone),
							serde_json::json!({
								"type": "Request",
								"server_id": server_id_clone,
								"id": id,
								"method": method,
								"params": params,
							}),
						);
					}
				} else {
					let method = value
						.get("method")
						.and_then(|v| v.as_str())
						.unwrap_or("")
						.to_string();
					let params = value
						.get("params")
						.cloned()
						.unwrap_or(serde_json::Value::Null);
					let _ = app_clone.emit(
						&format!("mcp-notification:{}", server_id_clone),
						McpEvent::Notification {
							server_id: server_id_clone.clone(),
							method,
							params,
						},
					);
				}
			}
		}
	});

	let mcp_child = McpChild {
		child,
		stdin,
		reader_handle: Some(reader_handle),
		pending,
		next_id: Mutex::new(1),
		server_id: server_id.clone(),
	};

	state
		.0
		.lock()
		.map_err(|e| e.to_string())?
		.insert(server_id, Arc::new(Mutex::new(mcp_child)));

	Ok(())
}

#[tauri::command]
pub async fn mcp_call(
	state: State<'_, McpHandles>,
	server_id: String,
	request_json: String,
	timeout_ms: Option<u64>,
) -> Result<String, String> {
	let timeout = timeout_ms.unwrap_or(30000);
	let child = {
		let handles = state.0.lock().map_err(|e| e.to_string())?;
		handles
			.get(&server_id)
			.ok_or("MCP server not found")?
			.clone()
	};

	let mut child = child.lock().await;

	let id = {
		let mut next = child.next_id.lock().await;
		let val = *next;
		*next += 1;
		val
	};

	let request: serde_json::Value =
		serde_json::from_str(&request_json).map_err(|e| format!("invalid JSON-RPC: {e}"))?;

	let mut envelope = request;
	if let Some(obj) = envelope.as_object_mut() {
		obj.insert("jsonrpc".to_string(), serde_json::json!("2.0"));
		obj.insert("id".to_string(), serde_json::json!(id));
	}
	let line = serde_json::to_string(&envelope).map_err(|e| e.to_string())? + "\n";

	let (tx, rx) = oneshot::channel();
	child.pending.lock().await.insert(id, tx);

	child
		.stdin
		.write_all(line.as_bytes())
		.await
		.map_err(|e| format!("write to MCP stdin: {e}"))?;
	child
		.stdin
		.flush()
		.await
		.map_err(|e| format!("flush MCP stdin: {e}"))?;

	match tokio::time::timeout(std::time::Duration::from_millis(timeout), rx).await {
		Ok(Ok(response)) => serde_json::to_string(&response).map_err(|e| e.to_string()),
		Ok(Err(_)) => Err("MCP response channel closed".to_string()),
		Err(_) => {
			child.pending.lock().await.remove(&id);
			Err("MCP request timed out".to_string())
		}
	}
}

#[tauri::command]
pub async fn mcp_notify(
	state: State<'_, McpHandles>,
	server_id: String,
	notification_json: String,
) -> Result<(), String> {
	let child = {
		let handles = state.0.lock().map_err(|e| e.to_string())?;
		handles
			.get(&server_id)
			.ok_or("MCP server not found")?
			.clone()
	};

	let mut child = child.lock().await;

	let notification: serde_json::Value =
		serde_json::from_str(&notification_json)
			.map_err(|e| format!("invalid JSON-RPC notification: {e}"))?;

	let mut envelope = notification;
	if let Some(obj) = envelope.as_object_mut() {
		obj.insert("jsonrpc".to_string(), serde_json::json!("2.0"));
	}
	let line = serde_json::to_string(&envelope).map_err(|e| e.to_string())? + "\n";

	child
		.stdin
		.write_all(line.as_bytes())
		.await
		.map_err(|e| format!("write to MCP stdin: {e}"))?;
	child
		.stdin
		.flush()
		.await
		.map_err(|e| format!("flush MCP stdin: {e}"))?;

	Ok(())
}

#[tauri::command]
pub async fn mcp_close(
	state: State<'_, McpHandles>,
	server_id: String,
) -> Result<(), String> {
	let child = {
		let mut handles = state.0.lock().map_err(|e| e.to_string())?;
		handles.remove(&server_id)
	};
	if let Some(child) = child {
		let mut child = child.lock().await;
		if let Some(handle) = child.reader_handle.take() {
			handle.abort();
		}
		let _ = child.child.kill().await;
	}
	Ok(())
}

#[tauri::command]
pub async fn mcp_respond(
	state: State<'_, McpHandles>,
	server_id: String,
	response_json: String,
) -> Result<(), String> {
	let child = {
		let handles = state.0.lock().map_err(|e| e.to_string())?;
		handles
			.get(&server_id)
			.ok_or("MCP server not found")?
			.clone()
	};

	let mut child = child.lock().await;

	let response: serde_json::Value =
		serde_json::from_str(&response_json)
			.map_err(|e| format!("invalid JSON-RPC response: {e}"))?;

	let line = serde_json::to_string(&response).map_err(|e| e.to_string())? + "\n";

	child
		.stdin
		.write_all(line.as_bytes())
		.await
		.map_err(|e| format!("write to MCP stdin: {e}"))?;
	child
		.stdin
		.flush()
		.await
		.map_err(|e| format!("flush MCP stdin: {e}"))?;

	Ok(())
}
