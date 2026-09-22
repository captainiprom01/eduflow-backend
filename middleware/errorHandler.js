function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found.' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  console.error('Unhandled server error', error);

  const statusCode = error.statusCode || error.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error.' : error.message;

  res.status(statusCode).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
