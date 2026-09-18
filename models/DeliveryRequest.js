const mongoose = require('mongoose');

/**
 * A cash request raised for a delivery employee — either an Amount
 * Request (a cash advance/reimbursement) or a Commission Request (payout
 * of earned commission, see DeliveryCommissionSetup). Both Admin >
 * Manage Delivery pages share this one model, split by `type`, since
 * they're the same shape: who, how much, why, and office's approve/
 * reject decision.
 */
const deliveryRequestSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['amount', 'commission'], required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    amount: { type: Number, required: true, default: 0 },
    method: { type: String, enum: ['', 'cash', 'bkash', 'nagad', 'bank'], default: '' }, // commission requests only
    note: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryRequest', deliveryRequestSchema);
