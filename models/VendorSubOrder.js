const mongoose = require('mongoose');

const subOrderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, required: true },
    qty: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

/**
 * Multivendor Phase 2 — Parent Order + Vendor Sub-order, and the
 * settlement/return hooks built on top of it.
 *
 * One row per (Order, Vendor) pair. Created at checkout time
 * (routes/store.js, right after the parent Order is created) by grouping
 * that order's items by each item's product.vendor — an order with items
 * from two vendors gets two VendorSubOrder rows, one per vendor. An order
 * with no vendor-owned items creates none.
 *
 * SETTLEMENT (item 9 — "Settlement System"): a sub-order's earning is only
 * ever credited to the vendor's wallet once the *parent* Order's status is
 * changed to 'delivered' (see applyStatusChange() in routes/admin.js,
 * settleVendorSubOrders()) — never at order placement, since the order can
 * still be cancelled or returned before then. That credit writes a real
 * VendorWalletTransaction (type 'order_earning') AND updates
 * Vendor.walletBalance, exactly like every other wallet-affecting action in
 * this app. `settlementStatus` moves pending -> settled at that point.
 *
 * RETURNS / REFUNDS (item 10): if the parent Order is later moved to
 * 'returned' or 'cancelled' (reverseVendorSubOrders() in routes/admin.js):
 *   - a sub-order still 'pending' (never settled) simply becomes
 *     'cancelled' — no money ever moved, so there's nothing to reverse.
 *   - a sub-order that was already 'settled' gets a matching
 *     'refund_deduction' VendorWalletTransaction for the same amount,
 *     Vendor.walletBalance is debited back down, and settlementStatus
 *     becomes 'reversed'. `refundedAmount` records how much was clawed back.
 *
 * HONEST SCOPE: this only handles a *whole order* being returned/cancelled.
 * Order.deliveryIssueStatus's 'partially_return' value (a partial, per-item
 * return) is NOT hooked up here — this app has no per-item refund-amount
 * concept anywhere yet, even for the platform's own non-vendor orders, so
 * building genuine partial-item vendor refunds would mean inventing that
 * concept from scratch. Out of scope for this pass.
 *
 * DISPUTES: a vendor who disagrees with a reversal can leave a note
 * (`disputeStatus`/`disputeNote`, set from /vendor/orders). There is no
 * automatic resolution — an Admin reads the note on Admin > Vendors >
 * (vendor) and either resolves it with a note (`disputeResolutionNote`) or
 * manually re-credits the vendor via the existing Wallet Adjustment form.
 */
const vendorSubOrderSchema = new mongoose.Schema(
  {
    parentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    orderNumber: { type: String, required: true }, // denormalized so lists don't need to populate the parent
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    items: [subOrderItemSchema],
    subtotal: { type: Number, required: true, default: 0 },
    // Snapshot of the vendor's commission rate at the moment the order was
    // placed — later changes to Vendor.commissionPercent must not
    // retroactively change what an already-placed order earns.
    commissionPercent: { type: Number, required: true, default: 0 },
    commissionAmount: { type: Number, required: true, default: 0 },
    vendorEarning: { type: Number, required: true, default: 0 },
    settlementStatus: { type: String, enum: ['pending', 'settled', 'reversed', 'cancelled'], default: 'pending' },
    settledAt: { type: Date, default: null },
    refundedAmount: { type: Number, default: 0 },
    disputeStatus: { type: String, enum: ['none', 'vendor_disputed', 'resolved'], default: 'none' },
    disputeNote: { type: String, default: '' },
    disputeResolutionNote: { type: String, default: '' },
  },
  { timestamps: true }
);

vendorSubOrderSchema.index({ vendor: 1, createdAt: -1 });

module.exports = mongoose.model('VendorSubOrder', vendorSubOrderSchema);
