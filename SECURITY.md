# Security Policy

## Supported Versions

Only the current release line receives security updates. Older versions are not
actively maintained.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report security vulnerabilities privately through GitHub's built-in
security advisory system:

1. Go to [https://github.com/bendlikeabamboo/mayon/security](https://github.com/bendlikeabamboo/mayon/security).
2. Click **"Report a vulnerability"**.
3. Describe the vulnerability with as much detail as possible, including steps
   to reproduce and the potential impact.

This ensures the report reaches maintainers privately and allows coordinated
disclosure.

## Secure Storage Posture

Mayon takes a defense-in-depth approach to credential handling:

- **Desktop (Tauri):** API keys are stored in the OS keychain (Keychain Access
  on macOS, Credential Manager on Windows, Secret Service on Linux) via the
  `keyring` crate. Plaintext keys never enter the webview layer.
- **Browser:** API keys are stored in IndexedDB, scoped to the origin.
- **Never in settings:** Provider API keys are never persisted in the SQLite
  `settings` table. A one-time boot migration (`migrateLegacyKeys`) moves any
  legacy key rows into the runtime key store.
