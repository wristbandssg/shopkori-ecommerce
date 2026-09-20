const mongoose = require('mongoose');

/**
 * "Pixel Settings" tab CRUD table (see views/admin/customization-store-settings.ejs).
 * Saved and listed for real, but — like models/MarketingSetting.js's own
 * facebookPixel/tiktokPixel cards which already inject real tracking
 * scripts into the storefront — these rows are NOT (yet) read by any
 * storefront script-injection code, to avoid two competing pixel sources.
 * Kept as its own collection (not a StoreCustomization card) since it's a
 * list of any number of platform pixels, not a single settings card.
 */
const pixelSettingSchema = new mongoose.Schema(
  {
    platform: { type: String, required: true, trim: true },
    pixelId: { type: String, default: '' },
    pixelAccessToken: { type: String, default: '' },
    facebookCatalogId: { type: String, default: '' },
    testEventCode: { type: String, default: '' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PixelSetting', pixelSettingSchema);
