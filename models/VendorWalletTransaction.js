const mongoose = require('mongoose');

/**
 * One row per change to a vendor's wallet balance (Admin > Vendors >
 * (vendor) > Wallet, and the vendor's own /vendor/wallet page). This is
 * the real ledger models/Vendor.js's `walletBalance` field is kept in
 * sync with — every write to a vendor's balance happens by creating one
 * of these AND updating Vendor.walletBalance in the same place, never by
 * changing the balance alone.
 *
 * Entries are created from four places: (1) an Admin manually
 * crediting/debiting a vendor's wallet (type 'adjustment', Admin > Vendors
 * > (vendor) > Wallet > Add Adjustment), (2) a vendor's withdrawal request
 * being approved (type 'withdrawal', see models/VendorWithdrawal.js), (3) a
 * parent Order reaching 'delivered' status, which settles every pending
 * VendorSubOrder on it (type 'order_earning' — see models/VendorSubOrder.js
 * and settleVendorSubOrders() in routes/admin.js), and (4) a delivered
 * order later being returned/cancelled, which reverses an already-settled
 * sub-order's earning back out (type 'refund_deduction' — see
 * reverseVendorSubOrders() in routes/admin.js).
 *
 * HONEST SCOPE NOTE: 'commission_deduction' is defined in the enum but not
 * currently written anywhere — the commission is simply never credited in
 * the first place (vendorEarning on VendorSubOrder is already
 * post-commission), so there's nothing to separately "deduct" today. It's
 * kept for a future pass that may want the commission to show as its own
 * ledger line instead of being folded silently into the earning amount.
 */
const vendorWalletTransactionSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    type: {
      type: String,
      enum: ['order_earning', 'commission_deduction', 'withdrawal', 'refund_deduction', 'adjustment'],
      required: true,
    },
    // Positive = credited to the vendor (order_earning, a positive
    // adjustment). Negative = debited (commission_deduction, withdrawal,
    // refund_deduction, a negative adjustment).
    amount: { type: Number, required: true },
    // Running balance immediately AFTER this entry was applied — makes the
    // transaction history readable without re-summing the whole ledger.
    balanceAfter: { type: Number, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    withdrawal: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorWithdrawal', default: null },
    note: { type: String, default: '' },
    // Which Admin made a manual 'adjustment' entry (null for system/vendor-
    // triggered entries like a withdrawal debit).
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

vendorWalletTransactionSchema.index({ vendor: 1, createdAt: -1 });

module.exports = mongoose.model('VendorWalletTransaction', vendorWalletTransactionSchema);
