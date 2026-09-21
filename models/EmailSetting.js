const mongoose = require('mongoose');

/**
 * Admin > API & Integration Management > Email Provider. Same singleton
 * get-or-create + merge-update pattern as models/PaymentSetting.js /
 * models/MarketingSetting.js.
 *
 * Saved-only: package.json has no email-sending library (no nodemailer or
 * similar dependency anywhere in this app) and no route sends an actual
 * email through these credentials — same honest scope already established
 * for PaymentSetting's bkash/manual cards. Disclosed on its own settings
 * page (views/admin/integrations-email.ejs) and in the integration hub.
 */
const emailSettingSchema = new mongoose.Schema(
  {
    smtpHost: { type: String, default: '' },
    smtpPort: { type: String, default: '' },
    smtpUsername: { type: String, default: '' },
    smtpPassword: { type: String, default: '' },
    fromAddress: { type: String, default: '' },
    status: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const EmailSettingModel = mongoose.model('EmailSetting', emailSettingSchema);

let cache = null;

async function getEmailSetting() {
  if (cache) return cache;
  let doc = await EmailSettingModel.findOne({});
  if (!doc) doc = await EmailSettingModel.create({});
  cache = doc;
  return doc;
}

async function updateEmailSetting(data) {
  const doc = await getEmailSetting();
  Object.assign(doc, data);
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { EmailSettingModel, getEmailSetting, updateEmailSetting };
