const mongoose = require('mongoose');

/**
 * Singleton config for Admin > Help & Support's contact channels. This
 * page is the STORE ADMIN reaching ShopKori's own platform support team
 * (the banner literally says "for decisions or technical problems") — a
 * different audience from models/HomeSetting.js's phone/email/whatsapp,
 * which are the STORE's own contact details shown to CUSTOMERS on the
 * storefront. Reusing HomeSetting here would wrongly mix "how customers
 * reach this store" with "how this store's admin reaches ShopKori", so
 * this is its own small settings doc instead.
 *
 * No edit form was shown in the reference design for this page, so these
 * stay fixed defaults (placeholder ShopKori-support contact values) —
 * there's no UI to change them yet, same as models/ReferralSetting.js.
 */
const helpSupportSettingSchema = new mongoose.Schema(
  {
    supportPhone: { type: String, default: '+880 1700-000000' },
    supportEmail: { type: String, default: 'support@shopkori.test' },
    // Opened in a new tab by the "Talk on Live Chat" card — a wa.me link,
    // since this app has no real-time chat server of its own.
    liveChatUrl: { type: String, default: 'https://wa.me/8801700000000' },
    communityUrl: { type: String, default: 'https://facebook.com/groups/shopkoricommunity' },
  },
  { timestamps: true },
);

const HelpSupportSettingModel = mongoose.model('HelpSupportSetting', helpSupportSettingSchema);

let cache = null;
async function getHelpSupportSetting() {
  if (cache) return cache;
  let doc = await HelpSupportSettingModel.findOne();
  if (!doc) doc = await HelpSupportSettingModel.create({});
  cache = doc;
  return doc;
}

module.exports = { HelpSupportSettingModel, getHelpSupportSetting };
