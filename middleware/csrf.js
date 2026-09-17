const crypto = require('crypto');

/**
 * Lightweight session-based CSRF protection (no external dependency needed).
 * Exposes req.csrfToken() to generate/reuse a token, and validates
 * req.body.csrfToken (or req.query.csrf for simple GET action links) on
 * state-changing requests.
 */
function csrfMiddleware(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  req.csrfToken = () => req.session.csrfToken;
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function verifyCsrf(req, res, next) {
  const token = req.body.csrfToken || req.query.csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('Form expired or invalid (CSRF check failed). Please go back and try again.');
  }
  next();
}

module.exports = { csrfMiddleware, verifyCsrf };
