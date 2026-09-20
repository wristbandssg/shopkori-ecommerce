const mongoose = require('mongoose');

/**
 * A purchase order: stock bought in from a supplier (see
 * views/admin/purchase-form.ejs). Creating one is real — it increments
 * the matching Product's (or variant's) `stock` for real (routes/admin.js
 * saveePurchase), the same `stock` field the storefront already checks at
 * checkout — so this isn't a cosmetic log, it actually restocks products
 * (see savePurchase() in routes/admin.js).
 */
const purchaseItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sku: { type: String, default: '' },
    image: { type: String, default: null },
    title: { type: String, required: true },
    variation: { type: String, default: '' },
    buyingPrice: { type: Number, default: 0 },
    quantity: { type: Number, required: true, default: 1 },
    subtotal: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: [purchaseItemSchema],
    total: { type: Number, default: 0 },
    note: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'received'], default: 'received' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Purchase', purchaseSchema);
