const mongoose = require('mongoose');

/**
 * Admin > Security Dashboard > Blocked IPs. Genuinely enforced — POST
 * /login in routes/admin.js checks this collection and refuses to even
 * attempt a password check for a blocked IP.
 */
const blockedIpSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, unique: true, trim: true },
    reason: { type: String, default: '' },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlockedIp', blockedIpSchema);
