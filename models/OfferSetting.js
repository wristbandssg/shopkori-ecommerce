const mongoose = require('mongoose');

/**
 * Singleton document backing all 8 "Offer Setting" sidebar pages (see
 * views/admin/partials/admin-header.ejs's #navOffer): Flash Sale, Combo
 * Offer, Best Sale Products, Popular Products, Hot Deal, Special Offer,
 * Latest Products, PopUp Offer. Same get-or-create + merge-update pattern
 * as models/StoreCustomization.js / models/ThemeCustomizer.js.
 *
 * LIVE vs SAVE-ONLY (see routes/admin.js's OFFER SETTING section for the
 * exact wiring):
 *   - flashSale: LIVE. Its selected products set Product.isFlashSale —
 *     the same flag routes/store.js's homepage query already reads — so
 *     this genuinely drives the existing "ফ্ল্যাশ সেল" homepage section.
 *     `enabled` toggles that section on/off; the timer (when turned on)
 *     computes a real `endsAt` and drives a real countdown badge there,
 *     styled with textColor/borderColor/backgroundColor.
 *   - popular: LIVE. Its selected products set Product.isFeatured — the
 *     flag already driving the homepage's "জনপ্রিয় প্রোডাক্ট" section.
 *     `enabled` toggles that section.
 *   - latest: LIVE. `enabled` toggles the homepage "নতুন সংযোজন" (New
 *     Arrivals) section — that section was already just "most recent
 *     products", so there's no separate product list to pick here.
 *   - popup: LIVE. When enabled (and an image has been uploaded) it shows
 *     as a real dismissible popup on the storefront (see header.ejs).
 *   - combo / bestSale / hotDeal / special: SAVE-ONLY. The product list
 *     (and, for hotDeal/special, the timer + colors) is genuinely saved
 *     here and reloads correctly on every visit, but no homepage section
 *     for these 4 categories exists yet — the screenshots only showed the
 *     admin forms, not a homepage design for them, so rather than invent
 *     4 new storefront sections unasked, this is left honestly saved-only.
 */
const offerProductSchema = new mongoose.Schema(
  { product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true } },
  { _id: false }
);

// Shared shape for a "pick some products" card, optionally with a timer.
function collectionFields(withTimer) {
  const fields = {
    enabled: { type: Boolean, default: false },
    products: [offerProductSchema],
  };
  if (withTimer) {
    Object.assign(fields, {
      timerEnabled: { type: Boolean, default: false },
      timerType: { type: String, enum: ['days', 'hours', 'minutes'], default: 'days' },
      duration: { type: Number, default: 0 }, // count of timerType units, e.g. 7 (days)
      endsAt: { type: Date, default: null }, // computed server-side at save time: now + duration
      textColor: { type: String, default: '#ffffff' },
      borderColor: { type: String, default: '#EC0E8C' },
      backgroundColor: { type: String, default: '#EC0E8C' },
    });
  }
  return fields;
}

const offerSettingSchema = new mongoose.Schema(
  {
    flashSale: collectionFields(true),
    combo: collectionFields(false),
    bestSale: collectionFields(false),
    popular: collectionFields(false),
    hotDeal: collectionFields(true),
    special: collectionFields(true),
    latest: {
      enabled: { type: Boolean, default: true },
    },
    popup: {
      enabled: { type: Boolean, default: false },
      title: { type: String, default: '' },
      image: { type: String, default: null },
      url: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

const OfferSettingModel = mongoose.model('OfferSetting', offerSettingSchema);

const POPULATE_PATHS = [
  'flashSale.products.product',
  'combo.products.product',
  'bestSale.products.product',
  'popular.products.product',
  'hotDeal.products.product',
  'special.products.product',
];

let cache = null;

// Used by the storefront (middleware/storeLocals.js) — cached, no product
// population needed there (only `enabled`/timer/color/popup fields are read).
async function getOfferSetting() {
  if (cache) return cache;
  let doc = await OfferSettingModel.findOne({});
  if (!doc) doc = await OfferSettingModel.create({});
  cache = doc;
  return doc;
}

// Used by the admin pages — always fresh, with each card's product list
// populated so the "SL / SKU / Product Name" table can render names.
async function getOfferSettingPopulated() {
  let doc = await OfferSettingModel.findOne({}).populate(POPULATE_PATHS);
  if (!doc) doc = await (await OfferSettingModel.create({})).populate(POPULATE_PATHS);
  return doc;
}

// Merges each top-level key given into the singleton doc — nested sub-docs
// are shallow-merged so saving one card never wipes another card's data;
// a `products` array in partial fully replaces that card's product list
// (each "Save Now" submits that card's complete current table).
async function updateOfferSetting(partial) {
  let doc = await OfferSettingModel.findOne({});
  if (!doc) doc = await OfferSettingModel.create({});
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

module.exports = { OfferSettingModel, getOfferSetting, getOfferSettingPopulated, updateOfferSetting };
