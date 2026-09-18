const mongoose = require('mongoose');

/**
 * A reusable variation TYPE (e.g. "Color", "Size", "Weight") with its own
 * list of possible values (e.g. Red/Blue/Green). This is a small library
 * only — on its own it never touches a product.
 *
 * A product's actual purchasable variants still live on the product itself
 * (Product.variants — each row its own SKU/price/stock, see
 * models/Product.js) because every real variant needs its own stock count
 * kept in sync at checkout, and a flat editable row list is a far simpler,
 * more robust admin UI than a generated Color x Size combination matrix.
 *
 * What this library adds is speed: Admin > Manage Product > Products >
 * Add Variant reads this list to offer a "Quick Add from Attribute" helper,
 * so the admin can tick Red/Blue/Green once here and reuse it on every
 * product instead of typing the same labels out by hand every time.
 */
const variantAttributeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    values: [{ type: String, trim: true }],
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VariantAttribute', variantAttributeSchema);
