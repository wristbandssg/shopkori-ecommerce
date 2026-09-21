const mongoose = require('mongoose');

/**
 * A marketplace seller account — the foundation of ShopKori's multivendor
 * layer (Admin > Vendors). A vendor self-registers on the storefront
 * (POST /vendor/register in routes/store.js), submits KYC documents, and
 * an Admin reviews and approves/rejects both the KYC and the account
 * itself before the vendor's public store (/store/:slug) goes live or the
 * vendor can be assigned any products.
 *
 * Two independent status fields, on purpose:
 *  - `kycStatus` — has the office verified this vendor's identity/business
 *    documents? A vendor can be logged in and editing their profile with
 *    kycStatus still 'pending'.
 *  - `accountStatus` — is this vendor's store actually live on the site?
 *    'pending' (awaiting first approval) -> 'active' (approved, store is
 *    live) -> 'suspended' (office pulled it down) / 'rejected' (never
 *    approved). The storefront (/store/:slug and product listings) only
 *    ever shows a vendor whose accountStatus is 'active'.
 *
 * `walletBalance` is a cached running total, kept in sync with the
 * VendorWalletTransaction ledger (models/VendorWalletTransaction.js) —
 * every ledger entry updates this field in the same operation so the
 * balance never has to be recomputed by summing the whole ledger.
 */
const vendorSchema = new mongoose.Schema(
  {
    // -- Identity / login --
    ownerName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    password: { type: String, required: true },

    // -- Store --
    storeName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true }, // public store URL: /store/:slug
    storeDescription: { type: String, default: '' },
    storeLogo: { type: String, default: null },
    storeBanner: { type: String, default: null },
    address: { type: String, default: '' },

    // -- KYC (Know Your Customer / business verification) --
    kyc: {
      nidNumber: { type: String, default: '' },
      nidDocument: { type: String, default: null }, // uploaded photo of the NID card
      tradeLicenseNumber: { type: String, default: '' },
      tradeLicenseDocument: { type: String, default: null }, // uploaded photo of the trade license
      bankAccountName: { type: String, default: '' },
      bankAccountNumber: { type: String, default: '' },
      bankName: { type: String, default: '' },
      submittedAt: { type: Date, default: null },
    },
    kycStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    kycRejectionReason: { type: String, default: '' },

    // -- Account / approval --
    accountStatus: { type: String, enum: ['pending', 'active', 'suspended', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },

    // -- Commission --
    // Percentage of each order this vendor sells that the platform keeps.
    // Defaults to settings.vendor_default_commission_percent when a vendor
    // is created (see routes/store.js POST /vendor/register); an Admin can
    // override it per-vendor from Admin > Vendors > (vendor) > Edit.
    commissionPercent: { type: Number, default: 10 },

    // -- Wallet (see models/VendorWalletTransaction.js for the ledger this
    // balance is kept in sync with) --
    walletBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Vendor', vendorSchema);
