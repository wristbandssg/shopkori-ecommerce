const mongoose = require('mongoose');

/**
 * A referral-commission payout request raised by an Admin from their own
 * Admin > Referral Program > Payout tab (self-service — mirrors the
 * existing Admin > Manage Delivery > Commission Request flow, see
 * models/DeliveryRequest.js). `admin` is whoever requested it; any
 * logged-in admin can mark a pending request Paid/Rejected inline from
 * the same table — this app has no per-admin permission enforcement yet
 * beyond login-gating (see models/Role.js), so there's no separate
 * "approver" role to require here either.
 */
const referralPayoutRequestSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['', 'cash', 'bkash', 'nagad', 'bank'], default: '' },
    paymentNumber: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ReferralPayoutRequest', referralPayoutRequestSchema);
