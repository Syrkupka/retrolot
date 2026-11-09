// Дочірній процес для тесту одночасних ставок: власне з'єднання з базою, чекає спільного моменту старту, потім ставить.
const [, , userId, lotId, amount, startAt] = process.argv;
const bids = require('../bids/service');

while (Date.now() < Number(startAt)) { /* крутимось у циклі, щоб усі процеси поставили в ту саму мілісекунду */ }
try {
  const r = bids.placeBid(Number(userId), Number(lotId), { amount: Number(amount) });
  process.stdout.write(JSON.stringify({ ok: true, leading: r.leading }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e.code }));
}
