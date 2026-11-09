# test/bids.test.js

Модульні тести ставок. Викликають `bids/service.js` напряму, без сервера.

## Що перевіряють
| Тест | Що доводить |
|---|---|
| first bid must reach the start price... | перша ставка не менша за стартову, далі не менше кроку |
| equal bids: the second one is rejected | дві однакові ставки: друга відхилена, у базі одна |
| seller cannot bid, closed and upcoming lots refuse bids | на свій лот не можна; закриті, ще не початі й не схвалені лоти не приймають ставок |
| same Idempotency-Key does not create a second bid | повтор запиту з тим самим ключем не створює дубль |
| auto-bid defends the leader up to its limit | автоставка відповідає на перебиття |
| two auto-bids: higher limit wins one step above the other | більша межа виграє на один крок вище меншої |
| three auto-bids settle without looping forever | три автоставки не зациклюються |
| bid history is immutable | база не дає змінити чи видалити ставку |
| **concurrent equal bids from separate processes** | **8 процесів одночасно ставлять 500: приймається рівно одна** |
| one bid cannot jump more than 10x... | ставку на мільярд одним кроком не поставити |

## Як працює тест гонки
1. Створює лот і 8 учасників.
2. Запускає 8 окремих процесів Node (`bid-worker.js`), кожен зі своїм з'єднанням з базою.
3. Усі чекають одного моменту (`startAt`, через 1,5 с) і ставлять 500 в ту саму мілісекунду.
4. Перевіряє: успішна одна, решта отримали `bid_too_low`; у лоті `current_price = 500`, `bid_count = 1`.

Окремі процеси важливі: в одному процесі Node запити й так ідуть по черзі, і тест нічого б не довів.

## Запуск
```bash
npm test
```
