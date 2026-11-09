const crypto = require('node:crypto');
const { DomainError } = require('./errors');
const log = require('./log');
const auth = require('../auth/service');

// Код помилки бізнес-логіки -> HTTP-статус. Чому саме такі коди, пояснено в docs/errors.md.
const STATUS = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  blocked: 403,
  not_found: 404,
  conflict: 409,
  bid_too_low: 409,
  lot_closed: 409,
  edit_locked: 409,
  payment_closed: 409,
  email_taken: 409,
  not_configured: 404,
};

function problem(res, status, code, detail, extra) {
  res.status(status).type('application/problem+json').json({
    type: `/problems/${code}`,
    title: code,
    status,
    detail,
    requestId: res.locals.requestId,
    ...extra,
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Ідентифікатор запиту + JSON-лог кожного запиту. Заголовки (cookie, авторизація) ніколи не потрапляють у лог.
function requestContext(req, res, next) {
  const id = crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  req.cookies = parseCookies(req.headers.cookie);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    log.info('request', {
      requestId: id, method: req.method, path: req.path, status: res.statusCode,
      ms: Number(process.hrtime.bigint() - t0) / 1e6,
    });
  });
  next();
}

function loadUser(req, res, next) {
  req.user = auth.userBySession(req.cookies.sid);
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return problem(res, 401, 'unauthorized', 'Login required');
  next();
}

function requireAdmin(req, res, next) {
  // не-адміни отримують 404, щоб адмінське API не видавало свого існування
  if (req.user?.role !== 'admin') return problem(res, 404, 'not_found', 'Not found');
  next();
}

function errorHandler(err, req, res, next) {
  if (err instanceof DomainError) return problem(res, STATUS[err.code] || 400, err.code, err.message, err.extra);
  if (err.type === 'entity.too.large') return problem(res, 413, 'too_large', 'Request body too large');
  if (err.type === 'entity.parse.failed') return problem(res, 400, 'validation', 'Malformed JSON');
  log.error('unhandled', { requestId: res.locals.requestId, error: err.message, stack: err.stack });
  problem(res, 500, 'internal', 'Internal server error'); // клієнт не бачить стектрейсу
}

function setSessionCookie(res, token) {
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1',
    maxAge: auth.SESSION_MS, path: '/',
  });
}

module.exports = { problem, requestContext, loadUser, requireUser, requireAdmin, errorHandler, setSessionCookie };
