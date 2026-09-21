const mongoose = require('mongoose');

/**
 * A record of a sensitive admin action, for Admin > Security > Audit Log.
 *
 * HONEST SCOPE NOTE: this is written from the new Vendor Management
 * actions only (KYC approve/reject, account approve/suspend/reject,
 * withdrawal approve/reject, commission rate change — see the vendor
 * routes in routes/admin.js) — it is NOT retrofitted across this app's
 * ~150 other existing admin routes. That would be a much bigger, separate
 * pass (same honest-scope call as models/Role.js's permission
 * enforcement). Written here rather than left out so the multivendor
 * system's own actions are traceable from day one.
 */
const auditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    adminName: { type: String, default: '' }, // denormalized snapshot, survives the Admin account later being deleted
    action: { type: String, required: true }, // e.g. 'vendor.kyc_approved', 'vendor.suspended', 'vendor.withdrawal_approved'
    targetType: { type: String, default: '' }, // e.g. 'Vendor', 'VendorWithdrawal'
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    details: { type: String, default: '' }, // short human-readable summary, e.g. "Rejected KYC: blurry NID photo"
    ip: { type: String, default: '' },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
