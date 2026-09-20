const mongoose = require('mongoose');

/**
 * "Home Setting" page (see views/admin/customization-home-setting.ejs) —
 * a single contact/social block for the storefront header or footer.
 * Not a cached singleton like StoreCustomization: the admin UI itself
 * shows an empty "No settings found" state until the first row is
 * created, then always shows/edits that one row — so the route handler
 * just does a plain findOne({}) and creates on first save.
 */
const homeSettingSchema = new mongoose.Schema(
  {
    header: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    twitter: { type: String, default: '' },
    facebook: { type: String, default: '' },
    youtube: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    messenger: { type: String, default: '' },
    logo: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HomeSetting', homeSettingSchema);
