const jwt = require('jsonwebtoken');

/**
 * Extracts JWT token from Authorization header
 * @param {string} authHeader - The Authorization header value
 * @returns {string|null} - The extracted token or null if not found
 */
function extractToken(authHeader) {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

/**
 * Middleware to verify JWT authentication
 * Extracts and validates the token from Authorization header
 * Sets req.userId if token is valid
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function requireAuth(req, res, next) {
  // Validate environment setup
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization || '';
  const token = extractToken(authHeader);

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  try {
    // Verify and decode token
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!payload.userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    req.userId = payload.userId;
    next();
  } catch (e) {
    // Distinguish between different JWT errors
    let message = 'Invalid or expired session. Please log in again.';
    
    if (e.name === 'TokenExpiredError') {
      message = 'Session expired. Please log in again.';
    } else if (e.name === 'JsonWebTokenError') {
      message = 'Invalid token format.';
    }

    console.warn(`Auth error: ${e.name} - ${e.message}`);
    return res.status(401).json({ error: message });
  }
}

module.exports = { requireAuth, extractToken };
