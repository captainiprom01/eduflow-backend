const logger = require('../lib/logger');

function notFound(req, res) {
  res.status(404).json({
    error: 'Route not found.',
    code: 'ROUTE_NOT_FOUND',
    requestId: req.requestId,
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  logger.error('http.error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  });
  res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Internal server error.',
    code: error.code || 'INTERNAL_ERROR',
    requestId: req.requestId,
  });
}

module.exports = { notFound, errorHandler };
