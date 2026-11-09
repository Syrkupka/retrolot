# ADR 0003: Offset pagination

Status: accepted, 2026-10-28

## Context
The catalogue, history, notifications and admin lists need paging. Users jump to page N and the UI shows
"page 3 of 8" and a total count.

## Options
1. Cursor (keyset) pagination: `WHERE (ends_at, id) > (:last_ends, :last_id)`. Stable under inserts, O(page) cost.
2. Offset pagination: `LIMIT :size OFFSET (:page - 1) * :size` plus `COUNT(*)`.

## Decision
Offset pagination with a stable tiebreaker (`ORDER BY <sort>, id`) and page size capped at 60.

## Consequences
+ Direct links to any page, total count and page numbers come for free.
+ Same code for all lists and all sort orders (price, end time, newest).
- A lot added or ended between two page loads can shift items by one position.
- Deep pages cost more (`OFFSET` still walks skipped rows). With 200 to a few thousand active lots this is negligible.

## Revisit when
Lists grow past tens of thousands of rows or infinite scroll replaces numbered pages.
