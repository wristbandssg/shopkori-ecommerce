const mongoose = require('mongoose');

/**
 * One row per storefront search (Admin > Analytics > Search Analytics).
 * Logged from GET /search in routes/store.js — fire-and-forget, same
 * pattern as middleware/trackPageView.js (models/PageView.js), so a slow
 * or failed write here never delays real search results.
 *
 * `sessionKey` mirrors PageView's field of the same name (req.session.id)
 * and Order.trackToken (also req.sessionID — see checkOrderLimitCard in
 * routes/store.js) — the same value space, so "did this search convert"
 * can be computed by matching sessionKey against Order.trackToken instead
 * of adding a new field to Order or duplicating that identifier.
 */
const searchLogSchema = new mongoose.Schema(
  {
    query: { type: String, required: true, trim: true },
    resultCount: { type: Number, required: true, default: 0 },
    sessionKey: { type: String, default: '' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  },
  { timestamps: true },
);

searchLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SearchLog', searchLogSchema);
