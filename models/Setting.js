const mongoose = require('mongoose');

/**
 * Simple key/value settings store (mirrors the PHP version's site_settings table).
 */
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: '' },
});

const SettingModel = mongoose.model('Setting', settingSchema);

const DEFAULTS = {
  site_name: 'ShopKori',
  site_tagline: 'Gifts, Groceries & Everyday Essentials Delivered',
  currency_symbol: '৳',
  flat_shipping_fee: '80',
  bkash_number: '01700-000000',
  phone: '+880 1700-000000',
  email: 'support@shopkori.test',
  address: 'House 12, Road 5, Mohammadpur, Dhaka-1207, Bangladesh',
};

let cache = null;

async function getSettings() {
  if (cache) return cache;
  const rows = await SettingModel.find({});
  const settings = { ...DEFAULTS };
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  cache = settings;
  return settings;
}

async function setSetting(key, value) {
  await SettingModel.findOneAndUpdate({ key }, { key, value }, { upsert: true });
  cache = null; // invalidate cache
}

async function ensureDefaults() {
  const existing = await SettingModel.find({});
  const existingKeys = new Set(existing.map((r) => r.key));
  const toInsert = Object.entries(DEFAULTS)
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, value]) => ({ key, value }));
  if (toInsert.length) {
    await SettingModel.insertMany(toInsert);
  }
  cache = null;
}

module.exports = { SettingModel, getSettings, setSetting, ensureDefaults, DEFAULTS };
