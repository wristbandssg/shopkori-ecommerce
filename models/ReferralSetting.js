const mongoose = require('mongoose');

/**
 * Singleton config for Admin > Referral Program's Guideline card (see
 * routes/admin.js's REFERRAL PROGRAM section for exactly how
 * commissionAmount is applied to real orders). The reference design's
 * Guideline card has no edit form of its own — just display text and a
 * copyable link — so these stay fixed defaults matching that screenshot's
 * copy rather than something editable from the admin UI yet.
 */
const referralSettingSchema = new mongoose.Schema(
  {
    guidelineTitle: { type: String, default: 'Refer a friend and earn ৳500 per paid signup!' },
    guidelineSubtitle: { type: String, default: 'Earn Your Commission & Payout' },
    // Flat commission, in currency units, credited once per referred
    // customer's first qualifying ("paid") order — see qualifyingReferralOrders()
    // in routes/admin.js.
    commissionAmount: { type: Number, default: 500 },
  },
  { timestamps: true },
);

const ReferralSettingModel = mongoose.model('ReferralSetting', referralSettingSchema);

let cache = null;
async function getReferralSetting() {
  if (cache) return cache;
  let doc = await ReferralSettingModel.findOne();
  if (!doc) doc = await ReferralSettingModel.create({});
  cache = doc;
  return doc;
}

module.exports = { ReferralSettingModel, getReferralSetting };
