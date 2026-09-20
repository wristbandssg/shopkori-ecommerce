const mongoose = require('mongoose');

/**
 * One row per storefront page load (see middleware/trackPageView.js).
 * Backs Admin > Analytics > Store Visitors (daily traffic + unique
 * visitor count) and Store Top Clicks (most-viewed pages) — real,
 * accumulating data rather than placeholder numbers.
 */
const pageViewSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, index: true },
    ip: { type: String, default: '' },
    // Best-effort "unique visitor" key — the session id when one exists
    // (assigned to every visitor, logged in or not, by express-session).
    sessionKey: { type: String, default: '', index: true },
    userAgent: { type: String, default: '' },
    referrer: { type: String, default: '' },
  },
  { timestamps: true }
);
pageViewSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PageView', pageViewSchema);
