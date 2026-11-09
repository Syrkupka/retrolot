# lots/routes.js

HTTP-маршрути лотів і ставок. Підключені за адресою `/api`. Самі нічого не рахують, лише передають запит у сервіс і повертають відповідь.

## Маршрути
| Метод і адреса | Хто може | Сервіс |
|---|---|---|
| `GET /categories`, `GET /tags` | усі | довідники |
| `GET /lots` | усі | `lots.list` |
| `GET /lots/mine` | увійшов | `lots.mine` |
| `GET /history` | увійшов | `lots.history` |
| `GET /watchlist` | увійшов | `lots.watchlist` |
| `GET /bids/mine` | увійшов | `bids.myBids` |
| `GET /lots/:id` | усі | `lots.get` |
| `POST /lots` | увійшов | `lots.create`, відповідь 201 |
| `PUT /lots/:id` | продавець | `lots.update` |
| `POST /lots/:id/withdraw` | продавець | `lots.withdraw` |
| `PUT` / `DELETE /lots/:id/watch` | увійшов | стежити / не стежити |
| `POST /lots/:id/bids` | увійшов | `bids.placeBid` |
| `PUT /lots/:id/auto-bid` | увійшов | `bids.setAuto` |

## Деталі
- **`id(req)`**: перетворює `:id` з адреси на число; сміття на кшталт `/lots/abc` дає 404.
- **Ставка**: заголовок `Idempotency-Key` перевіряється (8-100 символів, літери, цифри, `-`, `_`). Нова ставка дає **201**, повтор того самого запиту дає **200**.
- Порядок маршрутів важливий: `/lots/mine` стоїть раніше за `/lots/:id`, інакше `mine` сприйнялось би як id.
