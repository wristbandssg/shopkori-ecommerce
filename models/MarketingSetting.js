const mongoose = require('mongoose');

/**
 * Singleton document holding the "Marketing Settings" page's integration
 * cards (see views/admin/marketing.ejs / marketing-manage.ejs). Same
 * get-doc-or-create + per-card update pattern as models/OrderSetting.js.
 *
 * What each card actually drives, once turned ON:
 *  - facebookPixel / tiktokPixel / googleTagManager / googleAnalytics:
 *    their real tracking snippet is injected into the storefront <head>
 *    (see middleware/storeLocals.js + views/partials/header.ejs) whenever
 *    status is ON and the id is filled in.
 *  - facebookCatalog: not a script — Meta polls a live product feed URL.
 *    Turning it ON doesn't inject anything; the feed at
 *    /feed/facebook-catalog.xml (routes/store.js) is always live and
 *    reflects the current catalogId, ready to paste into Commerce Manager.
 *  - sms: a generic HTTP(S) gateway (see lib/sms.js) used for the "Send
 *    Test SMS" action on its Manage page. Not wired into checkout yet —
 *    that would need a specific gateway's real, tested credentials.
 */
const marketingSettingSchema = new mongoose.Schema(
  {
    sms: {
      apiUrl: { type: String, default: '' }, // template — supports {apiKey} {senderId} {number} {message}
      apiKey: { type: String, default: '' },
      senderId: { type: String, default: '' },
      status: { type: Boolean, default: false },
    },
    facebookPixel: {
      pixelId: { type: String, default: '' },
      accessToken: { type: String, default: '' }, // Conversions API, optional
      status: { type: Boolean, default: false },
    },
    tiktokPixel: {
      pixelId: { type: String, default: '' },
      status: { type: Boolean, default: false },
    },
    googleTagManager: {
      containerId: { type: String, default: '' }, // GTM-XXXXXXX
      status: { type: Boolean, default: false },
    },
    googleAnalytics: {
      measurementId: { type: String, default: '' }, // G-XXXXXXX
      status: { type: Boolean, default: false },
    },
    facebookCatalog: {
      catalogId: { type: String, default: '' },
      status: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const MarketingSettingModel = mongoose.model('MarketingSetting', marketingSettingSchema);

let cache = null;

async function getMarketingSettings() {
  if (cache) return cache;
  let doc = await MarketingSettingModel.findOne({});
  if (!doc) doc = await MarketingSettingModel.create({});
  cache = doc;
  return doc;
}

async function updateMarketingSettingCard(cardKey, data) {
  const doc = await getMarketingSettings();
  doc[cardKey] = { ...(doc[cardKey] ? doc[cardKey].toObject() : {}), ...data };
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { MarketingSettingModel, getMarketingSettings, updateMarketingSettingCard };
