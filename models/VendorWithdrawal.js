const mongoose = require('mongoose');

/**
 * A vendor's request to cash out part of their wallet balance (vendor's
 * own /vendor/wallet page -> "Request Withdrawal"; reviewed at Admin >
 * Vendors > Withdrawal Requests). Same shape as the existing delivery-
 * employee payout flow (models/DeliveryRequest.js), for the same reason:
 * who, how much, which method, and the office's approve/reject decision.
 *
 * Approving a request is what actually moves money: it creates a
 * matching 'withdrawal' entry in VendorWalletTransaction and decrements
 * Vendor.walletBalance, both in the same route (see saveVendorWithdrawal
 * decision handling in routes/admin.js) — a request sitting at 'pending'
 * has NOT touched the vendor's balance yet.
 */
const vendorWithdrawalSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['bkash', 'nagad', 'bank'], required: true },
    methodDetails: { type: String, default: '' }, // e.g. the bKash number or bank account entered at request time
    note: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, default: '' },
    processedAt: { type: Date, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

vendorWithdrawalSchema.index({ vendor: 1, createdAt: -1 });

module.exports = mongoose.model('VendorWithdrawal', vendorWithdrawalSchema);
