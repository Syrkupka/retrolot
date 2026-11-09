# ADR 0002: SQLite (node:sqlite) instead of PostgreSQL

Status: accepted, 2026-10-28

## Context
The guidelines ask for PostgreSQL or a justified alternative. The app is a single server with a few dozen
concurrent users. The development machine has no PostgreSQL or Docker installed; the database must be
recreated from scratch with one command.

## Options
1. PostgreSQL in a container: industry default, real row locks, needs Docker everywhere including CI.
2. SQLite through the built-in `node:sqlite` module: one file, no driver dependency, WAL mode, serializable writers.

## Decision
SQLite in WAL mode with `BEGIN IMMEDIATE` for every write transaction. Migrations are plain `.sql` files
applied in order and tracked by `PRAGMA user_version`.

## Consequences
+ `npm run seed` recreates the full schema and data in about a second; no external service to start.
+ Writers are serialized by the database lock, which makes the bid rule (ADR 0001) trivially safe.
+ Backup is a file copy (`sqlite3 .backup` or copying the file while the server is stopped).
- Only one write at a time: fine for an auction of this size, a bottleneck at thousands of writes per second.
- No horizontal scaling of the app server against one shared database file.
- `node:sqlite` is still marked experimental in Node 24.

## Revisit when
More than one app server is needed or write load stops fitting one writer. The SQL is portable; the
migration would mostly be changing `INSERT OR IGNORE` / `PRAGMA` lines.
