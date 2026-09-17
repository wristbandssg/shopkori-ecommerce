/**
 * Minimal flash-message middleware (mirrors the PHP version's flash_set/flash_get).
 * Usage: req.flash('success', 'Saved!');  ...  res.locals.flashes (auto-populated per request)
 */
function flashMiddleware(req, res, next) {
  if (!req.session.flashes) {
    req.session.flashes = [];
  }
  req.flash = (type, message) => {
    req.session.flashes.push({ type, message });
  };
  // Pop all flashes for this render, then clear them
  res.locals.flashes = req.session.flashes;
  req.session.flashes = [];
  next();
}

module.exports = flashMiddleware;
