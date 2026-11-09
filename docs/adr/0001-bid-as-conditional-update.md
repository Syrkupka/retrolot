# ADR 0001: A bid is one conditional UPDATE

Status: accepted, 2026-10-28

## Context
Two bidders can send the same amount at the same millisecond. The naive flow "read current price, compare
in code, write" has a gap between read and write: both requests read 400, both decide 500 beats it, both
write, and the lot ends up with two "highest" bids.

## Options
1. Read-check-write in application code inside a transaction with an app-level mutex per lot.
2. `SELECT ... FOR UPDATE` style row lock, then check in code (PostgreSQL-only, SQLite has no row locks).
3. A single `UPDATE lots SET current_price = :amount ... WHERE id = :lot AND :amount >= current_price + min_step AND <bidding window>`
   and look at the number of changed rows.

## Decision
Option 3. Zero changed rows means "someone was first or the lot closed"; only then the lot is re-read to
explain why. The `INSERT INTO bids` happens in the same `BEGIN IMMEDIATE` transaction.

## Consequences
+ Correct across processes and connections, not just inside one Node process (tested with 8 parallel processes in `test/bids.test.js`).
+ The rule lives in one SQL statement that is easy to read and review.
- Error messages need a second read to tell "too low" from "closed".
- Auto-bids reuse the same statement in a loop, so their logic is less obvious than plain code.

## Revisit when
We move to a database with row-level locking and need per-bid business rules that cannot be expressed in SQL.
