const mongoose = require('mongoose');

/**
 * Editable static content pages (About Us, FAQ, How to Order, How to Pay,
 * Terms, Privacy, Refund, Shipping). Admins edit these from /admin/pages
 * instead of the text being hardcoded in the route file.
 */
const pageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Page', pageSchema);
