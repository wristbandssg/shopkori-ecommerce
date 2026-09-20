const mongoose = require('mongoose');

/**
 * Singleton document backing the "Customization" section's Store Settings
 * page (see views/admin/customization-store-settings.ejs), which has 3
 * tabs: Brand Settings, Store Settings, Pixel Settings (Pixel Settings is
 * its own separate model — models/PixelSetting.js — since it's a list, not
 * a single card). Same get-or-create + merge-update pattern as
 * models/OrderSetting.js.
 *
 * Deliberately does NOT duplicate site_name/email/phone/address — those
 * stay owned by models/Setting.js (the existing General Settings source of
 * truth). The "Store Information" card's save handler writes those 4
 * fields through to Setting.js instead of storing a second copy here, so
 * there's only ever one place the storefront reads them from.
 */
const storeCustomizationSchema = new mongoose.Schema(
  {
    brand: {
      logoDark: { type: String, default: null },
      logoLight: { type: String, default: null },
      favicon: { type: String, default: null },
    },
    text: {
      titleText: { type: String, default: '' },
      footerText: { type: String, default: '' },
      dateFormat: { type: String, default: 'MMM D, YYYY' },
      timeFormat: { type: String, default: 'h:mm A' },
      timezone: { type: String, default: '(GMT+6:00) Asia/Dhaka' },
      enableRtl: { type: Boolean, default: false },
    },
    theme: {
      transparentLayout: { type: Boolean, default: false },
      darkLayout: { type: Boolean, default: false },
      navigationOnOff: { type: Boolean, default: false },
      showCartOnOff: { type: Boolean, default: false },
      primaryColor: { type: String, default: '#e0348b' },
    },
    store: {
      storeLogo: { type: String, default: null },
      invoiceLogo: { type: String, default: null },
      metaImage: { type: String, default: null },
      tagline: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zipcode: { type: String, default: '' },
      country: { type: String, default: '' },
      storeLanguage: { type: String, default: 'English' },
    },
    domain: {
      storeSlug: { type: String, default: '' },
      customDomain: { type: String, default: '' },
    },
    features: {
      checkoutLoginRequired: { type: Boolean, default: false },
      blogMenuDisplay: { type: Boolean, default: true },
      shippingMethod: { type: Boolean, default: true },
      productRating: { type: Boolean, default: true },
    },
    // Cosmetic/reference values only — the storefront's real Google
    // Analytics / Facebook Pixel injection is driven by the already-wired
    // Marketing Settings cards (models/MarketingSetting.js), not these.
    analyticsMeta: {
      googleAnalytics: { type: String, default: '' },
      facebookPixel: { type: String, default: '' },
      metaKeywords: { type: String, default: '' },
      metaDescription: { type: String, default: '' },
      decimalNumberFormat: { type: Number, default: 2 },
    },
    customJs: { type: String, default: '' },
  },
  { timestamps: true }
);

const StoreCustomizationModel = mongoose.model('StoreCustomization', storeCustomizationSchema);

let cache = null;

async function getStoreCustomization() {
  if (cache) return cache;
  let doc = await StoreCustomizationModel.findOne({});
  if (!doc) doc = await StoreCustomizationModel.create({});
  cache = doc;
  return doc;
}

// Merges each top-level key given into the singleton doc — nested sub-docs
// (brand/text/theme/store/domain/features/analyticsMeta) are shallow-merged
// so a save from one tab never wipes fields owned by another tab; flat
// fields (customJs) are set directly.
async function updateStoreCustomization(partial) {
  const doc = await getStoreCustomization();
  Object.keys(partial).forEach((key) => {
    const current = doc[key];
    if (current && typeof current === 'object' && typeof current.toObject === 'function') {
      doc[key] = { ...current.toObject(), ...partial[key] };
    } else {
      doc[key] = partial[key];
    }
  });
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { StoreCustomizationModel, getStoreCustomization, updateStoreCustomization };
