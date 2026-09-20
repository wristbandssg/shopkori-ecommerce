const mongoose = require('mongoose');

/**
 * "Order Page Setting" page (see views/admin/customization-order-page.ejs)
 * — labels/contact numbers for a storefront order/checkout action bar.
 * Same "single row, empty state until first created" shape as
 * models/HomeSetting.js — no screenshot showed where these labels get
 * displayed on the storefront, so (matching this session's "build only
 * what's shown" rule) this is admin CRUD only; it isn't read by any
 * storefront view yet.
 */
const orderPageSettingSchema = new mongoose.Schema(
  {
    buyMore: { type: String, default: '' },
    orderNow: { type: String, default: '' },
    callCenter: { type: String, default: '' },
    callCenterNumber: { type: String, default: '' },
    support: { type: String, default: '' },
    supportNumber: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    whatsappNumber: { type: String, default: '' },
    messenger: { type: String, default: '' },
    messengerLink: { type: String, default: '' },
    delivery: { type: String, default: '' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('OrderPageSetting', orderPageSettingSchema);
