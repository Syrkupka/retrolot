# Query plan: main catalogue

Query (page 1 of the main page, sorted by end time):

```sql
SELECT id FROM lots l
WHERE l.status = 'active' AND l.ends_at > ?
ORDER BY l.ends_at, l.id LIMIT 20;
```

Measured on the seeded database (200 lots), 2000 runs, `EXPLAIN QUERY PLAN`.

| | Plan | Avg time |
|---|---|---|
| Before (`migrations/001`) | `SCAN l` + `USE TEMP B-TREE FOR ORDER BY` | 42.2 µs |
| After (`migrations/002_lots_status_index.sql`) | `SEARCH l USING COVERING INDEX lots_status_ends (status=? AND ends_at>?)` | 17.8 µs |

Without the index SQLite reads every lot and sorts them in a temporary B-tree. With `(status, ends_at)`
it jumps straight to active lots in end-time order and stops after 20 rows. The gap grows with the table:
the scan is O(n log n), the index walk is O(page size).

Reproduce: run the `EXPLAIN QUERY PLAN` above in any SQLite shell against `data/auction.db`,
then `DROP INDEX lots_status_ends;` and run it again.
