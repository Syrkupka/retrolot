# admin/routes.js

Маршрути адмін-панелі. Підключені за адресою `/api/admin`. Перший рядок `r.use(requireAdmin)` закриває всі маршрути нижче: не-адмін отримує 404.

## Маршрути
| Метод і адреса | Що робить |
|---|---|
| `GET /lots` | черга модерації |
| `POST /lots/:id/moderate` | схвалити або відхилити (`{ decision, note }`) |
| `POST /lots/:id/cancel` | скасувати торги (`{ note }`) |
| `GET /users` | список користувачів (`?q=`, `?blocked=1`) |
| `PUT /users/:id/blocked` | заблокувати або розблокувати (`{ blocked: true/false }`) |

Видати права адміна через сайт не можна, лише командою `npm run make-admin` (див. `scripts-make-admin.md`).
