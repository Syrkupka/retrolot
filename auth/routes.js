const crypto = require('node:crypto');
const express = require('express');
const svc = require('./service');
const { problem, requireUser, setSessionCookie } = require('../lib/http');

const r = express.Router();
const G = () => ({
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  redirect: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/auth/google/callback`,
});

r.post('/register', (req, res) => {
  const id = svc.register(req.body);
  setSessionCookie(res, svc.createSession(id));
  res.status(201).json(svc.profile(id));
});

r.post('/login', (req, res) => {
  const id = svc.login(req.body);
  setSessionCookie(res, svc.createSession(id));
  res.json(svc.profile(id));
});

r.post('/logout', (req, res) => {
  svc.logout(req.cookies.sid);
  res.clearCookie('sid', { path: '/' });
  res.status(204).end();
});

r.get('/me', requireUser, (req, res) => res.json(svc.profile(req.user.id)));
r.patch('/me', requireUser, (req, res) => res.json(svc.updateProfile(req.user.id, req.body)));

// Вхід через Google (OAuth 2.0, обмін коду на токен). Працює лише якщо задано GOOGLE_CLIENT_ID і GOOGLE_CLIENT_SECRET.
r.get('/google', (req, res) => {
  const g = G();
  if (!g.id) return problem(res, 404, 'not_configured', 'Google login is not configured');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600000, path: '/' });
  const q = new URLSearchParams({
    client_id: g.id, redirect_uri: g.redirect, response_type: 'code', scope: 'openid email profile', state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

r.get('/google/callback', async (req, res) => {
  const g = G();
  if (!g.id || !req.query.code || req.query.state !== req.cookies.oauth_state) return res.redirect('/login?error=google');
  res.clearCookie('oauth_state', { path: '/' });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(req.query.code), client_id: g.id, client_secret: g.secret,
      redirect_uri: g.redirect, grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return res.redirect('/login?error=google');
  const { id_token } = await tokenRes.json();
  // id_token отримано напряму від Google через HTTPS, тож відправника вже перевірено (OIDC Core 3.1.3.7)
  const claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString());
  if (claims.aud !== g.id || !claims.email_verified) return res.redirect('/login?error=google');
  const id = svc.loginGoogle({ sub: claims.sub, email: claims.email, name: claims.name });
  setSessionCookie(res, svc.createSession(id));
  res.redirect('/');
});

module.exports = r;
