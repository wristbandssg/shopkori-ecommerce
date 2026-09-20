const mongoose = require('mongoose');

/**
 * Courier API integration configs (Settings > Courier). `courier` is one of
 * the same values used by middleware/orderConstants.js's COURIERS list, so
 * this stays in sync with the courier dropdown already shown on an order's
 * detail page — a courier configured here just means the admin has API
 * credentials on file for it, it doesn't replace that manual-tagging field.
 */
const courierSetupSchema = new mongoose.Schema(
  {
    courier: { type: String, required: true, trim: true },
    apiKey: { type: String, default: '' },
    secretKey: { type: String, default: '' },
    storeId: { type: String, default: '' },
    webhookUrl: { type: String, default: '' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CourierSetup', courierSetupSchema);
