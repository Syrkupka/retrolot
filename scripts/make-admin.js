// Видає (або з --remove забирає) права адміністратора. Запуск: npm run make-admin -- a@x.com b@y.com [--remove]
const { db } = require('../db');

const remove = process.argv.includes('--remove');
const emails = process.argv.slice(2).filter((a) => a !== '--remove');
if (!emails.length) {
  console.error('Usage: npm run make-admin -- email1 [email2 ...] [--remove]');
  process.exit(1);
}

for (const email of emails) {
  // колишній адмін стає продавцем, якщо має лоти, інакше учасником торгів
  const r = remove
    ? db.prepare(`UPDATE users SET role = CASE WHEN EXISTS (SELECT 1 FROM lots WHERE seller_id = users.id) THEN 'seller' ELSE 'bidder' END
        WHERE email = ? AND role = 'admin'`).run(email)
    : db.prepare("UPDATE users SET role = 'admin', blocked = 0, block_reason = NULL WHERE email = ?").run(email);
  console.log(r.changes ? `${email}: ${remove ? 'no longer admin' : 'is admin now'}` : `${email}: not found${remove ? ' or not an admin' : ' (register first)'}`);
}
