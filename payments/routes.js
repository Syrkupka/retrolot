const express = require('express');
const svc = require('./service');
const notifications = require('../notifications/service');
const { requireUser } = require('../lib/http');

const r = express.Router();
r.use(requireUser);

r.get('/payments/:id', (req, res) => res.json(svc.get(req.user.id, Number(req.params.id))));
r.post('/payments/:id/pay', (req, res) => res.json(svc.pay(req.user.id, Number(req.params.id), req.body)));

r.get('/notifications', (req, res) => res.json(notifications.list(req.user.id, { page: Math.max(1, Number(req.query.page) || 1) })));
r.post('/notifications/read', (req, res) => {
  notifications.markRead(req.user.id);
  res.status(204).end();
});

module.exports = r;
