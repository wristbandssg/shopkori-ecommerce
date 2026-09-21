const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    fullName: { type: String, default: '' },
    // Legacy free-text label (pre-dates models/Role.js) — kept, untouched,
    // for any account created before Staff > Roles existed. Nothing reads
    // it anymore except as a display fallback when `roleId` is unset (see
    // views/admin/staff-users.ejs).
    role: { type: String, default: 'admin' },
    // The real Role this account is assigned (Staff > Roles > User) — see
    // models/Role.js for what's actually enforced from it (login gating
    // only; the permission matrix itself isn't checked anywhere yet).
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    // "Login is enable" toggle on the Add/Edit User form — this one IS
    // genuinely enforced: routes/admin.js's POST /login checks it and
    // refuses to sign in a disabled account.
    loginEnabled: { type: Boolean, default: true },
    // Admin > Referral Program's personal share link (?ref=<code> on the
    // storefront's /register page — see middleware/storeLocals.js and
    // POST /register in routes/store.js). Generated lazily the first time
    // this admin opens Referral Program (see ensureAdminReferralCode() in
    // routes/admin.js), not set at account creation.
    referralCode: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', adminSchema);
