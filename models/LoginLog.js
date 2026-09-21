const mongoose = require('mongoose');

/**
 * One row per admin login attempt, success or failed — Admin > Security
 * Dashboard's Failed Logins, Admin Login History and Suspicious Activity
 * all read from this collection. Written from POST /login and
 * POST /login/2fa in routes/admin.js; never from anywhere else.
 */
const loginLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    usernameAttempted: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    status: { type: String, enum: ['success', 'failed'], required: true },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
);

loginLogSchema.index({ createdAt: -1 });
loginLogSchema.index({ ip: 1, createdAt: -1 });

module.exports = mongoose.model('LoginLog', loginLogSchema);
