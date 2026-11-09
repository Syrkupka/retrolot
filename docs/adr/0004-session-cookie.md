# ADR 0004: Server-side sessions in an httpOnly cookie

Status: accepted, 2026-10-28

## Context
The client is a same-origin SPA. We need login by email/password and by Google, logout that really logs out,
and admins able to block a user immediately.

## Options
1. JWT in `localStorage`, sent as `Authorization: Bearer`. Stateless, but readable by any injected script and hard to revoke.
2. Random session token in an `httpOnly; SameSite=Lax` cookie, only its SHA-256 stored in the `sessions` table.

## Decision
Option 2. Tokens are 32 random bytes; the database keeps only their hash, so a leaked DB dump cannot be
replayed as live sessions. Passwords are hashed with Argon2id (`crypto.argon2Sync`, OWASP parameters).

## Consequences
+ JavaScript cannot read the token, which limits XSS damage; CSP `script-src 'self'` limits XSS itself.
+ Logout deletes the row; blocking is checked on every write.
- One DB lookup per request.
- CSRF has to be considered: `SameSite=Lax` blocks cross-site POSTs, and the API only accepts JSON bodies.

## Revisit when
A separate mobile client or third-party API consumers appear; then add bearer tokens next to the cookie.
