const mongoose = require('mongoose');

/**
 * "Page Builder" (Settings > Page Builder) — ad-hoc informational/landing
 * pages an admin can create at any slug, any time. Deliberately a separate
 * model from models/Page.js: that one is a fixed 8-key set (About Us, FAQ,
 * Terms, ...) auto-seeded on every /admin/pages visit and has no create/
 * delete UI. This model has no fixed keys — the admin types the slug, name
 * and title themselves, and can delete a page entirely.
 */
const customPageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, default: '' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CustomPage', customPageSchema);
