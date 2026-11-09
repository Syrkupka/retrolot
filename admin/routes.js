const express = require('express');
const svc = require('./service');
const { requireAdmin } = require('../lib/http');

const r = express.Router();
r.use(requireAdmin);

r.get('/lots', (req, res) => res.json(svc.pendingLots(req.query)));
r.post('/lots/:id/moderate', (req, res) => res.json(svc.moderate(Number(req.params.id), req.body)));
r.post('/lots/:id/cancel', (req, res) => res.json(svc.cancel(Number(req.params.id), req.body)));
r.get('/users', (req, res) => res.json(svc.users(req.query)));
r.put('/users/:id/blocked', (req, res) => res.json(svc.setBlocked(req.user.id, Number(req.params.id), req.body)));

module.exports = r;
