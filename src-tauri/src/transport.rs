//! Desktop LLM streaming transport.
//!
//! Implements the Rust half of the request data flow (spec "Data flow → A request
//! (desktop)"): JS invokes `llm_stream`, this resolves the keychain secret into the
//! request header in Rust (so the plaintext never enters the webview), streams the
//! `reqwest` response body, and emits `llm-stream` events tagged by `stream_id`.
//! `llm_stream_cancel` aborts an in-flight stream via its stored `JoinHandle`.

use std::collections::HashMap;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, State};

/// In-flight stream task handles keyed by `stream_id`.
#[derive(Default)]
pub struct StreamHandles(
	pub std::sync::Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
);

/// Key-injection descriptor sent from JS. The secret is resolved in Rust from the
/// OS keychain and injected into `header` — it never transits the webview.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInjection {
	pub header: String,
	pub scheme: Option<String>,
	pub key_id: String,
}

/// Serialized event payload. Always carries `stream_id` (JS filters on it).
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type")]
enum StreamEvent {
	Headers { stream_id: String, status: u16 },
	Chunk { stream_id: String, text: String },
	Error { stream_id: String, status: Option<u16>, message: String },
	End { stream_id: String },
}

/// Best-effort removal of a finished/cancelled handle from managed state.
fn cleanup(app: &AppHandle, stream_id: &str) {
	if let Some(state) = app.try_state::<StreamHandles>() {
		if let Ok(mut map) = state.0.lock() {
			map.remove(stream_id);
		}
	}
}

/// Start a streamed LLM request. Spawns the streaming work onto the Tauri async
/// runtime, stores the task handle keyed by `stream_id`, and returns immediately;
/// progress is reported via `llm-stream` events.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn llm_stream(
	app: AppHandle,
	state: State<'_, StreamHandles>,
	url: String,
	method: Option<String>,
	headers: Option<HashMap<String, String>>,
	body: Option<String>,
	key_injection: Option<KeyInjection>,
	stream_id: String,
) -> Result<(), String> {
	let client = reqwest::Client::builder()
		.build()
		.map_err(|e| e.to_string())?;

	let method = reqwest::Method::from_bytes(
		method.as_deref().unwrap_or("GET").as_bytes(),
	)
	.map_err(|e| e.to_string())?;

	let mut header_map = reqwest::header::HeaderMap::new();
	if let Some(ref h) = headers {
		for (name, value) in h {
			let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
				.map_err(|e| e.to_string())?;
			let value = reqwest::header::HeaderValue::from_str(value)
				.map_err(|e| e.to_string())?;
			header_map.insert(name, value);
		}
	}
	if let Some(ref ki) = key_injection {
		let entry = keyring::Entry::new("Mayon", &ki.key_id).map_err(|e| e.to_string())?;
		let secret = entry.get_password().map_err(|e| e.to_string())?;
		let value = match ki.scheme {
			Some(ref scheme) => format!("{} {}", scheme, secret),
			None => secret,
		};
		let name = reqwest::header::HeaderName::from_bytes(ki.header.as_bytes())
			.map_err(|e| e.to_string())?;
		let value = reqwest::header::HeaderValue::from_str(&value)
			.map_err(|e| e.to_string())?;
		header_map.insert(name, value);
	}

	let app_clone = app.clone();
	let stream_id_clone = stream_id.clone();
	let handle = tauri::async_runtime::spawn(async move {
		let req = client.request(method, &url).headers(header_map);
		let req = match body {
			Some(b) => req.body(b),
			None => req,
		};

		let resp = match req.send().await {
			Ok(r) => r,
			Err(e) => {
				let _ = app_clone.emit(
					"llm-stream",
					StreamEvent::Error {
						stream_id: stream_id_clone.clone(),
						status: None,
						message: e.to_string(),
					},
				);
				cleanup(&app_clone, &stream_id_clone);
				return;
			}
		};

		let status = resp.status().as_u16();
		if !resp.status().is_success() {
			let body_text = resp.text().await.unwrap_or_default();
			let _ = app_clone.emit(
				"llm-stream",
				StreamEvent::Error {
					stream_id: stream_id_clone.clone(),
					status: Some(status),
					message: body_text,
				},
			);
			cleanup(&app_clone, &stream_id_clone);
			return;
		}

		let _ = app_clone.emit(
			"llm-stream",
			StreamEvent::Headers {
				stream_id: stream_id_clone.clone(),
				status,
			},
		);

		let mut stream = resp.bytes_stream();
		while let Some(chunk_result) = stream.next().await {
			match chunk_result {
				Ok(bytes) => {
					let text = String::from_utf8_lossy(&bytes).into_owned();
					let _ = app_clone.emit(
						"llm-stream",
						StreamEvent::Chunk {
							stream_id: stream_id_clone.clone(),
							text,
						},
					);
				}
				Err(e) => {
					let _ = app_clone.emit(
						"llm-stream",
						StreamEvent::Error {
							stream_id: stream_id_clone.clone(),
							status: None,
							message: e.to_string(),
						},
					);
					cleanup(&app_clone, &stream_id_clone);
					return;
				}
			}
		}

		let _ = app_clone.emit(
			"llm-stream",
			StreamEvent::End {
				stream_id: stream_id_clone.clone(),
			},
		);
		cleanup(&app_clone, &stream_id_clone);
	});

	state.0.lock().map_err(|e| e.to_string())?.insert(stream_id, handle);

	Ok(())
}

/// Cancel an in-flight stream by `stream_id`. No-op (returns `Ok`) if the stream
/// already finished or is unknown.
#[tauri::command]
pub async fn llm_stream_cancel(
	state: State<'_, StreamHandles>,
	stream_id: String,
) -> Result<(), String> {
	let handle = {
		let mut map = state.0.lock().map_err(|e| e.to_string())?;
		map.remove(&stream_id)
	};
	if let Some(handle) = handle {
		handle.abort();
	}
	Ok(())
}
