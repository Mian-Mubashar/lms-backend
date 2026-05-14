const cors = require('cors');

/**
 * Production CORS for split Vercel (frontend + backend) + local MERN dev.
 *
 * Env:
 *   FRONTEND_URL   — primary production frontend, e.g. https://lms-frontend-six-silk.vercel.app
 *   CORS_ORIGINS   — optional comma-separated extra origins (staging, custom domain)
 *
 * Also allows any *.vercel.app (preview deployments) and localhost in non-production.
 */

function normalizeOrigin(url) {
  if (!url || typeof url !== 'string') return null;
  const t = url.trim().replace(/\/+$/, '');
  return t || null;
}

function collectAllowedOrigins() {
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

const allowedExact = collectAllowedOrigins();

function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;
  if (allowedExact.has(normalized)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname.endsWith('.vercel.app') || hostname === 'vercel.app') return true;
  } catch {
    return false;
  }
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Type'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
  credentials: false
};

/**
 * Answer OPTIONS before body parsers / DB — echo Access-Control-Request-Headers
 * so Chrome preflight always matches.
 */
function preflight(req, res, next) {
  if (req.method !== 'OPTIONS') return next();

  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    return res.sendStatus(403);
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(','));

  const requested = req.headers['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requested || corsOptions.allowedHeaders.join(',')
  );
  res.setHeader('Access-Control-Max-Age', String(corsOptions.maxAge));
  return res.sendStatus(204);
}

const corsHandler = cors(corsOptions);

/** Apply in order: preflight first, then cors() for non-OPTIONS responses. */
function installCors(app) {
  app.use(preflight);
  app.use(corsHandler);
}

module.exports = {
  installCors,
  corsOptions,
  isOriginAllowed
};
