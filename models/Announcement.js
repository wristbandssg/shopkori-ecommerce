const mongoose = require('mongoose');

/**
 * Admin > Announcement System. The reference design's audience picker is
 * "To All Vendors / To Specific Vendors / To Customers / To Admin Staff" —
 * ShopKori has no Vendor concept at all (single-tenant, no models/Vendor.js),
 * so Vendor-targeting is dropped entirely rather than faked. What's left
 * maps onto real audiences that exist in this app: the storefront's own
 * customers, and this store's own admin/staff panel users.
 *
 * No distinct "Super Admin" role exists here beyond login-gating (see
 * models/Admin.js's roleId comment), so any logged-in admin can create and
 * manage announcements — same precedent already used for Referral Payout
 * approve/reject and Support Ticket resolve.
 */
const ANNOUNCEMENT_AUDIENCES = [
  { value: 'customers', label: 'Customers (storefront)' },
  { value: 'admin_staff', label: 'Admin Staff (this panel)' },
];

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    audience: { type: String, enum: ['customers', 'admin_staff'], required: true, default: 'customers' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

announcementSchema.index({ audience: 1, active: 1 });

const AnnouncementModel = mongoose.model('Announcement', announcementSchema);

module.exports = AnnouncementModel;
module.exports.ANNOUNCEMENT_AUDIENCES = ANNOUNCEMENT_AUDIENCES;
