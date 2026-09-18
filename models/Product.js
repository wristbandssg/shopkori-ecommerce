const mongoose = require('mongoose');

/**
 * A variant is a real, independently-purchasable version of the product
 * (e.g. "Red / Large") with its own SKU, price and stock. Kept as a flat
 * label rather than a generated option1 x option2 matrix, on purpose —
 * that keeps the admin UI a simple, robust add/remove row list instead of
 * a fragile client-side combination generator, while every variant still
 * behaves as a genuinely separate purchasable item (own stock, own price,
 * decremented independently at checkout).
 */
const variantSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    sku: { type: String, default: '' },
    price: { type: Number, default: null }, // null = use the product's regular price
    salePrice: { type: Number, default: null },
    stock: { type: Number, default: 0 },
    image: { type: String, default: null },
  },
  { timestamps: false }
);

const productSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Secondary/additional categories a product also shows up under, on top
    // of its required primary `category` (used for the breadcrumb and
    // related-products lookup). Category listing pages match either.
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },

    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    sku: { type: String, default: '' },
    tags: [{ type: String, trim: true }],
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },

    // -- Media --
    videoEmbed: { type: String, default: '' },
    videoPosition: { type: String, enum: ['', 'top', 'bottom'], default: '' },
    image: { type: String, default: null }, // cover image (800x800)
    galleryImage: { type: String, default: null }, // secondary product image (600x600)
    variantsChartImage: { type: String, default: null }, // e.g. a size chart

    // -- Pricing / stock --
    condition: { type: String, enum: ['new', 'used', 'refurbished'], default: 'new' },
    availability: { type: String, enum: ['in_stock', 'out_of_stock', 'pre_order'], default: 'in_stock' },
    buyingPrice: { type: Number, default: 0 }, // cost price, admin-only, never shown on the storefront
    price: { type: Number, required: true, default: 0 }, // regular price
    discountType: { type: String, enum: ['flat', 'percent'], default: 'flat' },
    discountValue: { type: Number, default: 0 },
    salePrice: { type: Number, default: null },
    stock: { type: Number, default: 0 },
    stockAlert: { type: Number, default: 5 },
    overselling: { type: Boolean, default: false }, // allow checkout to proceed past zero stock
    weight: { type: Number, default: 0 }, // kg — shown as product info; not yet used to compute shipping cost
    minOrderQty: { type: Number, default: 1 },
    maxOrderQty: { type: Number, default: null }, // null = no upper limit

    // -- Variants --
    hasVariants: { type: Boolean, default: false },
    variantMandatory: { type: Boolean, default: false }, // false = a "Standard" (no-variant) option is also purchasable
    variants: [variantSchema],

    // -- Description --
    offerDescription: {
      type: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
      text: { type: String, default: '' },
    },

    // -- Delivery, per product (see routes/store.js checkout for enforcement) --
    deliveryType: { type: String, enum: ['manual', 'free_shipping', 'flat_rate'], default: 'manual' },
    deliveryFlatRate: { type: Number, default: 0 },
    // Which payment methods this product may be checked out with. Empty = no
    // restriction (all of the site's payment methods are allowed).
    deliveryMethods: [{ type: String, enum: ['cod', 'bkash', 'sslcommerz'] }],

    // -- After Confirm Products (upsell shown on the order-success page) --
    afterConfirmEnabled: { type: Boolean, default: false },
    afterConfirmOfferDescription: { type: String, default: '' },
    afterConfirmProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // -- SEO --
    metaTitle: { type: String, default: '' },
    metaKeywords: { type: String, default: '' },
    metaDescription: { type: String, default: '' },

    isFeatured: { type: Boolean, default: false },
    isFlashSale: { type: Boolean, default: false },
    // `status` stays the single boolean every storefront/admin query already
    // filters on ("is this product visible right now"). `publishStatus` +
    // `publishAt` are the admin-facing Draft/Published/Schedule controls that
    // drive it — kept in sync in routes/admin.js (saveProduct, bulk-status,
    // duplicate) and by the scheduled-publish job in server.js, which flips
    // a due 'scheduled' product over to 'published'/status:true.
    status: { type: Boolean, default: true },
    publishStatus: { type: String, enum: ['draft', 'published', 'scheduled'], default: 'published' },
    publishAt: { type: Date, default: null },
    views: { type: Number, default: 0 },
    rating: { type: Number, default: 4.5 },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', shortDescription: 'text' });

// Virtual: effective selling price of the BASE product (i.e. with no variant
// selected). For a variant's own effective price, use effectivePriceOfVariant.
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

// The lowest price a shopper could actually pay for this product — the base
// price, or the cheapest variant's effective price when it has variants.
// Used for "from ৳X" display on product cards.
productSchema.methods.startingPrice = function startingPrice() {
  if (!this.hasVariants || !this.variants || !this.variants.length) return this.effectivePrice;
  const prices = this.variants.map((v) => {
    const base = v.price != null ? v.price : this.price;
    return v.salePrice && v.salePrice < base ? v.salePrice : base;
  });
  return Math.min(...prices, this.effectivePrice);
};

// Resolves the effective price + stock for a specific variant id (or the
// base product when variantId is falsy).
productSchema.methods.resolveVariant = function resolveVariant(variantId) {
  if (!variantId) {
    return { variant: null, label: '', price: this.effectivePrice, stock: this.stock };
  }
  const v = this.variants.id(variantId);
  if (!v) return null;
  const base = v.price != null ? v.price : this.price;
  const price = v.salePrice && v.salePrice < base ? v.salePrice : base;
  return { variant: v, label: v.label, price, stock: v.stock };
};

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
