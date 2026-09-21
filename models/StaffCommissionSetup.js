const mongoose = require('mongoose');

/**
 * A commission rule for a staff Role ("Employee Type" in the screenshot),
 * separate from models/DeliveryCommissionSetup.js (which is a per-employee,
 * order-count-threshold scheme used by Manage Delivery). This one is a flat
 * percentage of the order total, credited once per order when it reaches
 * whichever milestone(s) are turned on (afterCourier / afterDelivered —
 * mapped to Order.status 'courier'/'delivered', see middleware/orderConstants.js).
 *
 * The screenshot's "Commission Setups" table was empty (no example row),
 * so the exact meaning of the "After Courier"/"After Delivered" columns
 * was inferred, not shown — this is the original, disclosed interpretation:
 * two independent on/off milestones sharing one commission rate, rather
 * than two separate rates. It's genuinely read by the Staff Report (see
 * routes/admin.js) to compute each staff member's Commission Amount from
 * real Order data — not a cosmetic number.
 */
const staffCommissionSetupSchema = new mongoose.Schema(
  {
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    commissionRate: { type: Number, required: true, default: 0 }, // percent of order total
    afterCourier: { type: Boolean, default: false },
    afterDelivered: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StaffCommissionSetup', staffCommissionSetupSchema);
