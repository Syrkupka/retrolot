const path = require('node:path');
const express = require('express');
const { db } = require('./db');
const log = require('./lib/log');
const http = require('./lib/http');
const payments = require('./payments/service');
const mail = require('./notifications/mail');
const { DIR: UPLOADS } = require('./lots/images');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(http.requestContext);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    next();
  });
  // при створенні лота фото йдуть у тілі запиту (data URL), тож тут ліміт більший; решта запитів маленькі
  app.use(['/api/lots'], express.json({ limit: '25mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(http.loadUser);

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', time: Date.now() });
  });
  app.get('/api/config', (req, res) => res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID),
    support_email: process.env.SUPPORT_EMAIL || 'support@example.com',
    pay_window_hours: payments.PAY_WINDOW_MS / 3600000,
  }));
  app.use('/api/auth', require('./auth/routes'));
  app.use('/api/admin', require('./admin/routes'));
  app.use('/api', require('./lots/routes'));
  app.use('/api', require('./payments/routes'));
  app.use('/api', (req, res) => http.problem(res, 404, 'not_found', 'Unknown endpoint'));

  app.use('/uploads', express.static(UPLOADS, { maxAge: '7d', immutable: true }));
  app.use(express.static(path.join(__dirname, 'public'))); // браузер перевіряє ETag, тож оновлення сайту видно одразу
  // SPA: на будь-який інший GET віддаємо index.html, а сторінку вибирає роутер на клієнті
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.use(http.errorHandler);
  return app;
}

function startJobs(ms = 5000) {
  let busy = false;
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const ended = payments.closeEnded();
      const expired = payments.expireUnpaid();
      if (ended || expired) log.info('jobs', { ended, expired });
      await mail.sendPending();
    } catch (e) {
      log.error('job failed', { error: e.message });
    } finally {
      busy = false;
    }
  }, ms);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => log.info('listening', { port }));
  startJobs();
}

module.exports = { createApp, startJobs };
