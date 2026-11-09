const nodemailer = require('nodemailer');
const { db } = require('../db');
const log = require('../lib/log');

// Без SMTP_URL листи лише записуються в лог (для локальної розробки).
const transport = process.env.SMTP_URL
  ? nodemailer.createTransport(process.env.SMTP_URL)
  : nodemailer.createTransport({ jsonTransport: true });

const SITE = process.env.PUBLIC_URL || 'http://localhost:3000';

const TEXT = {
  outbid: (d) => [`Вашу ставку перебито: «${d.title}»`, `Поточна ціна ${d.amount} грн.`, `Your bid was outbid: "${d.title}". Current price ${d.amount} UAH.`],
  won: (d) => [`Ви виграли лот «${d.title}»`, `Сума ${d.amount} грн. Оплатіть до ${new Date(d.due).toLocaleString('uk-UA')}.`, `You won "${d.title}" for ${d.amount} UAH. Please pay before the deadline.`],
  sold: (d) => [`Торги завершено: «${d.title}»`, `Переможна ставка ${d.amount} грн. Очікуємо оплату.`, `Auction ended: "${d.title}", winning bid ${d.amount} UAH.`],
  no_bids: (d) => [`Торги завершено без ставок: «${d.title}»`, '', `Auction ended with no bids: "${d.title}".`],
  paid: (d) => [`Лот «${d.title}» оплачено`, `Покупець оплатив ${d.amount} грн. Контакти покупця на сторінці лота.`, `"${d.title}" was paid. Buyer contacts are on the lot page.`],
  receipt: (d) => [`Чек: «${d.title}»`, `Сплачено ${d.amount} грн, картка **** ${d.last4}.`, `Receipt: "${d.title}", paid ${d.amount} UAH, card **** ${d.last4}.`],
  payment_expired: (d) => [`Термін оплати минув: «${d.title}»`, 'Лот передано наступному учаснику, ваш акаунт заблоковано. Зверніться в підтримку.', `Payment deadline passed for "${d.title}". Your account is blocked.`],
  approved: (d) => [`Лот опубліковано: «${d.title}»`, '', `Your lot "${d.title}" was approved.`],
  rejected: (d) => [`Лот відхилено: «${d.title}»`, d.note || '', `Your lot "${d.title}" was rejected. ${d.note || ''}`],
  cancelled: (d) => [`Торги скасовано: «${d.title}»`, d.note || '', `Auction "${d.title}" was cancelled by the administrator.`],
  unblocked: () => ['Ваш акаунт розблоковано', '', 'Your account was unblocked.'],
};

async function sendPending() {
  const rows = db.prepare(`
    SELECT n.id, n.type, n.data, n.lot_id, u.email FROM notifications n JOIN users u ON u.id = n.user_id
    WHERE n.emailed = 0 ORDER BY n.id LIMIT 50`).all();
  for (const n of rows) {
    const make = TEXT[n.type];
    if (make) {
      const [subject, uk, en] = make(JSON.parse(n.data));
      const link = n.lot_id ? `\n\n${SITE}/lot/${n.lot_id}` : '';
      try {
        await transport.sendMail({ from: process.env.MAIL_FROM || 'noreply@localhost', to: n.email, subject, text: `${uk}\n\n${en}${link}` });
      } catch (e) {
        log.warn('mail failed', { notification: n.id, error: e.message });
        continue; // спробуємо ще раз на наступному запуску
      }
    }
    db.prepare('UPDATE notifications SET emailed = 1 WHERE id = ?').run(n.id);
  }
  if (rows.length) log.info('mail sent', { count: rows.length, smtp: Boolean(process.env.SMTP_URL) });
}

module.exports = { sendPending };
