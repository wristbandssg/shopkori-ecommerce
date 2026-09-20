const mongoose = require('mongoose');

/**
 * Singleton document holding the "Payment Methods" page's 3 cards
 * (see views/admin/payment-*.ejs). Same get-or-create + per-card
 * merge-update pattern as models/OrderSetting.js / models/MarketingSetting.js.
 *
 * The sslcommerz card is the one wired into something real: lib/sslcommerz.js
 * prefers these DB-stored credentials when status is on and a store ID is
 * set, falling back to the existing SSLCZ_STORE_ID/SSLCZ_STORE_PASSWORD env
 * vars otherwise — so turning this card on with real sandbox/live
 * credentials genuinely changes what the storefront checkout uses, it isn't
 * just a display value. bkash/manual have no existing API integration in
 * this codebase to wire into (the storefront's "bkash" payment method is
 * already a manual send-to-this-number flow using Setting.js's bkash_number
 * key), so those two cards are real, saved, reflected settings but are not
 * (yet) read by any checkout code path — same honest scope as the Marketing
 * SMS gateway card earlier in this app's build.
 */
const paymentSettingSchema = new mongoose.Schema(
  {
    bkash: {
      username: { type: String, default: '' },
      password: { type: String, default: '' },
      appKey: { type: String, default: '' },
      appSecret: { type: String, default: '' },
      status: { type: Boolean, default: false },
    },
    manual: {
      bkashNumber: { type: String, default: '' },
      nagadNumber: { type: String, default: '' },
      rocketNumber: { type: String, default: '' },
      status: { type: Boolean, default: false },
    },
    sslcommerz: {
      storeId: { type: String, default: '' },
      storePassword: { type: String, default: '' },
      transactionPrefix: { type: String, default: '' },
      appSecret: { type: String, default: '' },
      status: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const PaymentSettingModel = mongoose.model('PaymentSetting', paymentSettingSchema);

let cache = null;

async function getPaymentSettings() {
  if (cache) return cache;
  let doc = await PaymentSettingModel.findOne({});
  if (!doc) doc = await PaymentSettingModel.create({});
  cache = doc;
  return doc;
}

async function updatePaymentSettingCard(cardKey, data) {
  const doc = await getPaymentSettings();
  doc[cardKey] = { ...(doc[cardKey] ? doc[cardKey].toObject() : {}), ...data };
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { PaymentSettingModel, getPaymentSettings, updatePaymentSettingCard };
