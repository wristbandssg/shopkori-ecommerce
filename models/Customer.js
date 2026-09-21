const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    password: { type: String, required: true },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    status: { type: Boolean, default: true },
    // Set once, at registration, when this account was created via an
    // Admin's Referral Program share link (?ref=<code>) — see
    // middleware/storeLocals.js (captures the code into the session) and
    // POST /register in routes/store.js (resolves it to this field). Never
    // changes after signup. Drives Admin > Referral Program > Referral
    // Transaction / Referral Users / Payout (routes/admin.js).
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', customerSchema);
