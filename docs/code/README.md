# Пояснення до коду RetroLot

По одному файлу на кожен скрипт. Зірочкою позначено основні файли.

## Як усе з'єднано

```
браузер (public/app.js)
   │  fetch('/api/...')  JSON
   ▼
server.js ── lib/http.js (request id, лог, вхід, помилки)
   │
   ├─ auth/routes.js      ──> auth/service.js
   ├─ lots/routes.js      ──> lots/service.js, bids/service.js
   ├─ payments/routes.js  ──> payments/service.js, notifications/service.js
   └─ admin/routes.js     ──> admin/service.js
                                  │
                                  ▼
                               db.js (SQLite) ── migrations/*.sql
таймер у server.js (кожні 5 с): закрити лоти, прострочити оплати, розіслати листи
```

Правило шарів: `routes.js` знає про HTTP (req, res, статуси), `service.js` лише про бізнес-логіку і базу. Тому сервіси можна викликати з тестів без запуску сервера.

## Сервер
- [server.js](server.md): запуск, підключення маршрутів, фоновий таймер
- [db.js](db.md) *: з'єднання з базою, транзакції, міграції
- [migrations/001_init.sql](migrations-001_init.md) *: усі таблиці
- [migrations/002_lots_status_index.sql](migrations-002_lots_status_index.md): індекс для головної сторінки

## Спільні модулі (lib)
- [lib/http.js](lib-http.md): HTTP-шар, помилки problem+json, перевірка входу
- [lib/errors.js](lib-errors.md): клас помилки бізнес-логіки
- [lib/validate.js](lib-validate.md): перевірка вхідних даних, алгоритм Луна
- [lib/log.js](lib-log.md): JSON-логи

## Функціональні області
- [auth/service.js](auth-service.md) *: паролі (Argon2id), сесії, Google
- [auth/routes.js](auth-routes.md): маршрути входу й реєстрації, OAuth
- [bids/service.js](bids-service.md) **: ставки, конкурентність, автоставки
- [lots/service.js](lots-service.md) *: каталог, сторінка лота, створення, редагування
- [lots/routes.js](lots-routes.md): маршрути лотів і ставок
- [lots/images.js](lots-images.md): збереження фото
- [payments/service.js](payments-service.md) *: завершення торгів, оплата, неоплата
- [payments/routes.js](payments-routes.md): маршрути оплати й сповіщень
- [admin/service.js](admin-service.md): модерація, скасування, блокування
- [admin/routes.js](admin-routes.md): маршрути адмін-панелі
- [notifications/service.js](notifications-service.md): сповіщення на сайті
- [notifications/mail.js](notifications-mail.md): листи на email

## Клієнт (браузер)
- [public/app.js](public-app.md) *: весь інтерфейс сайту
- [public/i18n.js](public-i18n.md): тексти українською й англійською
- [public/style.css](public-style.md): стилі

## Дані й утиліти
- [seed.js](seed.md): демо-дані
- [seed-texts.js](seed-texts.md): описи демо-лотів
- [scripts/make-admin.js](scripts-make-admin.md): видати права адміна
- [scripts/check.js](scripts-check.md): перевірка синтаксису

## Тести
- [test/bids.test.js](test-bids.md) *: ставки й гонка 8 процесів
- [test/bid-worker.js](test-bid-worker.md): процес-учасник гонки
- [test/auction-flow.test.js](test-auction-flow.md): завершення, оплата, неоплата
- [test/e2e.test.js](test-e2e.md): наскрізний сценарій через HTTP
- [test/helpers.js](test-helpers.md): тимчасова база й тестові дані
