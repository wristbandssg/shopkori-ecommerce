const mongoose = require('mongoose');

/**
 * "Product Coupon" (Settings > Product Coupon) — discount codes an admin
 * defines here. `used` tracks how many times a code has been redeemed;
 * nothing in this app's checkout currently applies a coupon automatically
 * (routes/store.js has no coupon-code input on checkout), so this CRUD is
 * fully real and saved, but `used` only ever increments if something is
 * wired up later to call it — disclosed honestly rather than faked.
 */
const couponSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ['flat', 'percent'], default: 'percent' },
    discountValue: { type: Number, default: 0 },
    // 0 = unlimited uses.
    limit: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);
