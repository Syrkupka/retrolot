const express = require('express');
const svc = require('./service');
const bids = require('../bids/service');
const { requireUser } = require('../lib/http');
const { fail } = require('../lib/errors');

const r = express.Router();
const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isSafeInteger(n) || n < 1) fail('not_found', 'Lot not found');
  return n;
};

r.get('/categories', (req, res) => res.json(svc.categories()));
r.get('/tags', (req, res) => res.json(svc.tags()));

r.get('/lots', (req, res) => res.json(svc.list(req.query)));
r.get('/lots/mine', requireUser, (req, res) => res.json(svc.mine(req.user.id, req.query)));
r.get('/history', requireUser, (req, res) => res.json(svc.history(req.user.id, req.query)));
r.get('/watchlist', requireUser, (req, res) => res.json(svc.watchlist(req.user.id, req.query)));
r.get('/bids/mine', requireUser, (req, res) => res.json(bids.myBids(req.user.id, req.query)));

r.get('/lots/:id', (req, res) => res.json(svc.get(id(req), req.user)));
r.post('/lots', requireUser, (req, res) => res.status(201).json(svc.create(req.user.id, req.body)));
r.put('/lots/:id', requireUser, (req, res) => res.json(svc.update(req.user.id, id(req), req.body)));
r.post('/lots/:id/withdraw', requireUser, (req, res) => res.json(svc.withdraw(req.user.id, id(req))));
r.put('/lots/:id/watch', requireUser, (req, res) => res.json(svc.watch(req.user.id, id(req), true)));
r.delete('/lots/:id/watch', requireUser, (req, res) => res.json(svc.watch(req.user.id, id(req), false)));

r.post('/lots/:id/bids', requireUser, (req, res) => {
  const key = req.get('Idempotency-Key');
  if (key && !/^[\w-]{8,100}$/.test(key)) fail('validation', 'Bad Idempotency-Key');
  const result = bids.placeBid(req.user.id, id(req), req.body, key || null);
  res.status(result.replay ? 200 : 201).json(result);
});
r.put('/lots/:id/auto-bid', requireUser, (req, res) => res.json(bids.setAuto(req.user.id, id(req), req.body)));

module.exports = r;
