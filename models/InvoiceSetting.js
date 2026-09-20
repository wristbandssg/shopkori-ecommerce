const mongoose = require('mongoose');

/**
 * Singleton document for the "Invoice Setting" page — controls how an
 * order's printable invoice is numbered and branded. Same get-or-create
 * pattern as models/OrderSetting.js, but a single flat doc (no per-card
 * sub-keys) since there's only one form here.
 */
const invoiceSettingSchema = new mongoose.Schema(
  {
    invoicePrefix: { type: String, default: 'INV-' },
    startingNumber: { type: Number, default: 1000 },
    companyName: { type: String, default: '' },
    companyAddress: { type: String, default: '' },
    footerNote: { type: String, default: '' },
    taxPercent: { type: Number, default: 0 },
    showLogo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const InvoiceSettingModel = mongoose.model('InvoiceSetting', invoiceSettingSchema);

let cache = null;

async function getInvoiceSettings() {
  if (cache) return cache;
  let doc = await InvoiceSettingModel.findOne({});
  if (!doc) doc = await InvoiceSettingModel.create({});
  cache = doc;
  return doc;
}

async function updateInvoiceSettings(data) {
  const doc = await getInvoiceSettings();
  Object.assign(doc, data);
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { InvoiceSettingModel, getInvoiceSettings, updateInvoiceSettings };
