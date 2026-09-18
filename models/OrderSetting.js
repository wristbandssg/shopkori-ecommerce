const mongoose = require('mongoose');

/**
 * Singleton document holding the "Order Setting" page's blocking/validation
 * cards (see views/admin/orders-setting.ejs). Which cards are actually
 * ENFORCED at checkout (routes/store.js) vs. save-only is documented next
 * to each field below.
 */
const limitCardSchema = new mongoose.Schema(
  {
    message: { type: String, default: '' },
    status: { type: Boolean, default: false },
    supportNumber: { type: String, default: '' },
    orderLimit: { type: Number, default: 0 },
    blockMinutes: { type: Number, default: 60 },
  },
  { _id: false }
);

const orderSettingSchema = new mongoose.Schema(
  {
    // Save-only: blocking a specific number/IP needs an "Order Block" list
    // manager, which isn't built yet, so toggling these has nothing to
    // apply them to yet.
    numberBlocked: { message: { type: String, default: '' }, status: { type: Boolean, default: false } },
    ipBlocked: { message: { type: String, default: '' }, status: { type: Boolean, default: false } },

    // Save-only: real VPN/incognito/device-fingerprint detection needs a
    // paid third-party service we haven't wired up.
    vpnBlocked: { message: { type: String, default: '' }, status: { type: Boolean, default: false } },
    incognitoBlocked: { message: { type: String, default: '' }, status: { type: Boolean, default: false } },
    fingerprintLimit: limitCardSchema,

    // Enforced for real at checkout:
    numberValidation: { message: { type: String, default: '' }, status: { type: Boolean, default: false } },
    sameNumberLimit: limitCardSchema,
    sameIpLimit: limitCardSchema,
    cookiesLimit: limitCardSchema,

    // Save-only: needs an OTP SMS gateway / exit-intent JS we haven't built.
    fakeOrderSetting: {
      deliveryPercent: { type: Number, default: 0 },
      systemSetting: { type: String, default: 'OTP Mode' },
      status: { type: Boolean, default: false },
    },
    offerMissedOrder: {
      heading: { type: String, default: '' },
      message: { type: String, default: '' },
      couponCode: { type: String, default: '' },
      couponValue: { type: Number, default: 0 },
      timeSeconds: { type: Number, default: 3 },
      status: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const OrderSettingModel = mongoose.model('OrderSetting', orderSettingSchema);

let cache = null;

async function getOrderSettings() {
  if (cache) return cache;
  let doc = await OrderSettingModel.findOne({});
  if (!doc) doc = await OrderSettingModel.create({});
  cache = doc;
  return doc;
}

async function updateOrderSettingCard(cardKey, data) {
  const doc = await getOrderSettings();
  doc[cardKey] = { ...(doc[cardKey] ? doc[cardKey].toObject() : {}), ...data };
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { OrderSettingModel, getOrderSettings, updateOrderSettingCard };
