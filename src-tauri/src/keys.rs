//! OS keychain commands for provider API keys.
//!
//! Backed by the `keyring` crate, which uses macOS Keychain on Apple platforms,
//! the Windows Credential Manager on Windows, and the Secret Service
//! (libsecret / gnome-keyring) on Linux. Each provider key is stored under the
//! service name `"Mayon"` with the provider id as the entry name. The plaintext
//! secret never crosses back into the webview: only a boolean `has` probe is
//! exposed.

use keyring::Entry;

const SERVICE: &str = "Mayon";

/// Store a provider API key in the OS keychain.
#[tauri::command]
pub fn key_set(id: String, secret: String) -> Result<(), String> {
	let entry = Entry::new(SERVICE, &id).map_err(|e| e.to_string())?;
	entry.set_password(&secret).map_err(|e| e.to_string())
}

/// Return `true` iff a key exists for the provider id.
///
/// A not-found / "no entry" result maps to `Ok(false)`; any other keyring error
/// (e.g. a missing secret service on Linux) is surfaced as `Err` so the caller
/// gets a clear message instead of a crash.
#[tauri::command]
pub fn key_has(id: String) -> Result<bool, String> {
	let entry = Entry::new(SERVICE, &id).map_err(|e| e.to_string())?;
	match entry.get_password() {
		Ok(_) => Ok(true),
		Err(keyring::Error::NoEntry) => Ok(false),
		Err(e) => Err(e.to_string()),
	}
}

/// Delete a provider key from the keychain. Idempotent: a not-found error is
/// treated as success.
#[tauri::command]
pub fn key_delete(id: String) -> Result<(), String> {
	let entry = Entry::new(SERVICE, &id).map_err(|e| e.to_string())?;
	match entry.delete_password() {
		Ok(()) => Ok(()),
		Err(keyring::Error::NoEntry) => Ok(()),
		Err(e) => Err(e.to_string()),
	}
}
