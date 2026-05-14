/**
 * Vercel + Express: one middleware, all CORS headers on every request.
 * OPTIONS → 204 (preflight). No second cors() layer (avoids header conflicts).
 */

function writeCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
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

function installCors(app) {
  app.use((req, res, next) => {
    writeCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });
}

module.exports = {
  installCors,
  applyCorsHeaders: writeCorsHeaders
};
