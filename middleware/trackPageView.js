const PageView = require('../models/PageView');

// Never log feeds, payment callbacks, or static assets — only real
// storefront page loads count as a "visit"/"click" for Store Visitors /
// Store Top Clicks. Static files are served by express.static() before
// this middleware anyway, but the list is kept explicit for clarity.
const SKIP_PREFIXES = ['/feed/', '/payment/', '/uploads/', '/images/', '/css/', '/js/'];

/**
 * Best-effort visit logger for Admin > Analytics (Store Visitors / Store
 * Top Clicks). Fire-and-forget on purpose — a slow or failed write here
 * must never delay or break an actual page load, so the create() promise
 * is intentionally not awaited.
 */
function trackPageView(req, res, next) {
  if (req.method === 'GET' && !SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    PageView.create({
      path: req.path,
      ip: req.ip || '',
      sessionKey: (req.session && req.session.id) || '',
      userAgent: (req.get('User-Agent') || '').slice(0, 300),
      referrer: (req.get('Referer') || '').slice(0, 300),
    }).catch(() => {});
  }
  next();
}

module.exports = trackPageView;
