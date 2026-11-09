# Errors and status codes

All errors are `application/problem+json` (RFC 9457). `type` is stable (`/problems/<code>`), `requestId`
matches the `X-Request-Id` response header, 500 responses never contain a stack trace.

| type | status | why this code |
|---|---|---|
| `validation` | 400 | the request itself is malformed; `errors[]` lists `{field, rule}` |
| `unauthorized` | 401 | no session, or wrong email/password |
| `forbidden` | 403 | logged in but the action is not allowed (bidding on your own lot) |
| `blocked` | 403 | account blocked (unpaid lot or admin decision) |
| `not_found` | 404 | missing **or not yours**: hidden lots, other users' payments and the admin API all answer 404 so their existence is not confirmed |
| `bid_too_low` | 409 | conflict with current state: someone bid first; body carries `min_bid` |
| `lot_closed` | 409 | lot is not in the bidding window |
| `edit_locked` | 409 | lot already has bids (edit/withdraw are allowed only before the first bid) |
| `payment_closed` | 409 | payment deadline passed |
| `email_taken` | 409 | unique email conflict |
| `too_large` | 413 | body above the limit (photos) |
| `internal` | 500 | unexpected; details only in the server log |

409 is used for "your request was valid but the world changed" so the client knows to re-read state
and retry, unlike 400 where retrying the same body is pointless.
