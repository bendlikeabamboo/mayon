# Contract: Auth Recovery CLI (server-side only)

Entry: second tsup entry `server/src/auth/cli.ts`, wired as `pnpm --filter @mayon/server auth <command>`; inside the running stack: `docker compose exec server node dist/auth-cli.js <command>`. Requires direct server access (shell on the host running the containers) — this is the ONLY recovery channel (FR-016/FR-017); no command creates or leaves an MFA-less login path.

All commands share: read-only access to the same pool/migrations/crypto modules as the server; explicit confirmation prompts before destructive actions; TOTP secrets are never printed in plaintext — enrollment re-issues a fresh `otpauth://` URI for the user's authenticator app.

## Commands

| Command | Effect | Output |
|---------|--------|--------|
| `status` | Reads mode, identities, active session count, key-file presence. | human-readable summary; exit 0 |
| `reset-password --label <label>` | Prompts (stdin, hidden) for a new password ×2; re-argon2id-hashes; revokes that identity's sessions. Works regardless of current mode; the NEXT login still requires a valid TOTP code (FR-017). | confirmation |
| `reenroll-mfa --label <label>` | Generates + encrypts a fresh TOTP secret (old one discarded), resets `totp_last_step`, revokes that identity's sessions. | prints `otpauth://` URI to render/scan |
| `wipe-sessions` | Revokes every session row. | count revoked |
| `rotate-secret` | Generates a new outside-DB key, re-wraps every `totp_secret_enc` in place (fail-closed: aborts before writing if any row fails to decrypt), writes the new key file / instructs env update. | per-row wrap report |
| `set-mode --mode open\|locked` | Escapes hatch for the pathological cases (e.g. hostile enable on an open public deployment, stale locked backup restore): sets `security.mode` directly, revoking all sessions when leaving locked. | confirmation |

## Guarantees

- No command bypasses MFA: after `reset-password`, login = new password + valid code (SC-007 covers re-enroll + login under 15 minutes).
- `reenroll-mfa` on a `revoked` identity is refused (revocation is not undone by recovery; create a new invite).
- Commands that mutate require the server's DB to be reachable and migrations to be current (same boot checks as `start()`); they never run migrations themselves.
- Exit codes: `0` success, `1` usage/refused, `2` DB unreachable.
