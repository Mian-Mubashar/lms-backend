/**
 * Vercel serverless + split MERN: CORS headers on every response (incl. 503 JSON),
 * so the browser never sees "No Access-Control-Allow-Origin" on preflight or errors.
 *
 * Default: permissive for typical deploys (any Origin with browser + *.vercel.app / localhost).
 * Set CORS_STRICT=1 + FRONTEND_URL (+ optional CORS_ORIGINS) to lock down.
 */

const cors = require('cors');

function normalizeOrigin(url) {
  if (!url || typeof url !== 'string') return null;
  const t = url.trim().replace(/\/+$/, '');
  return t || null;
}

function buildAllowlist() {
  const set = new Set();
  const add = (u) => {
    const n = normalizeOrigin(u);
    if (n) set.add(n);
  };
  add(process.env.FRONTEND_URL);
  if (process.env.CORS_ORIGINS) {
    for (const part of process.env.CORS_ORIGINS.split(',')) {
      add(part.trim());
    }
  }
  add('http://localhost:3000');
  add('http://127.0.0.1:3000');
  add('http://localhost:5173');
  add('http://127.0.0.1:5173');
  return set;
}

const allowExact = buildAllowlist();
const strict =
  String(process.env.CORS_STRICT || '').toLowerCase() === '1' ||
  String(process.env.CORS_STRICT || '').toLowerCase() === 'true';

function isOriginAllowed(origin) {
  if (!strict) {
    if (!origin) return true;
    try {
      const { hostname } = new URL(origin);
      if (hostname.endsWith('.vercel.app') || hostname === 'vercel.app') return true;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    } catch {
      return false;
    }
    return true;
  }
  if (!origin) return true;
  const n = normalizeOrigin(origin);
  if (!n) return true;
  if (allowExact.has(n)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname.endsWith('.vercel.app') || hostname === 'vercel.app') return true;
  } catch {
    return false;
  }
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed = !origin || isOriginAllowed(origin);

  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'
  );
  const requested = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested ||
      'Content-Type, Authorization, Accept, Origin, X-Requested-With, Access-Control-Request-Method, Access-Control-Request-Headers'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function universalCors(req, res, next) {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin && !isOriginAllowed(origin)) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }

  next();
}

const laxCors = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (isOriginAllowed(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false
});

function installCors(app) {
  app.use(universalCors);
  app.use(laxCors);
}

module.exports = {
  installCors,
  isOriginAllowed,
  applyCorsHeaders
};
