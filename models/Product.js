const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    sku: { type: String, default: '' },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    price: { type: Number, required: true, default: 0 },
    salePrice: { type: Number, default: null },
    stock: { type: Number, default: 0 },
    image: { type: String, default: null },
    isFeatured: { type: Boolean, default: false },
    isFlashSale: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
    views: { type: Number, default: 0 },
    rating: { type: Number, default: 4.5 },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', shortDescription: 'text' });

// Virtual: effective selling price (sale price if valid, else regular price)
productSchema.virtual('effectivePrice').get(function () {
  return this.salePrice && this.salePrice < this.price ? this.salePrice : this.price;
});

productSchema.virtual('hasSale').get(function () {
  return !!(this.salePrice && this.salePrice < this.price);
});

productSchema.virtual('discountPercent').get(function () {
  if (!this.hasSale) return 0;
  return Math.round(((this.price - this.salePrice) / this.price) * 100);
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
