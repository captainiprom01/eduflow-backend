const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(allowedOrigins) {
  const origins = allowedOrigins === '*' ? null : new Set(allowedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const hasCookieAuth = Boolean(req.headers.cookie);
    if (!hasCookieAuth) return next();

    const origin = req.headers.origin;
    if (!origin || !origins || !origins.has(origin)) {
      return res.status(403).json({
        error: 'Request origin is not allowed.',
        code: 'CSRF_ORIGIN_REJECTED',
        requestId: req.requestId,
      });
    }
    next();
  };
}

module.exports = { csrfProtection };
