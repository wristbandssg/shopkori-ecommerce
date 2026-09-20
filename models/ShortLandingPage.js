const mongoose = require('mongoose');

/**
 * "Short Landing" pages — a lighter, single-image landing page built around
 * one or more highlighted products, each with its own title/colour styling
 * (unlike Main Landing's slider + customer-review-heavy layout). Used for
 * quick single-product or small-combo campaign pages.
 */
const shortLandingItemSchema = new mongoose.Schema(
  {
    mainTitle: { type: String, default: '' },
    mainTitleColor: { type: String, default: '#1e3a5f' },
    mainTitleBgColor: { type: String, default: '#ffffff' },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    // "Is Auto Cart" in the admin table — when true, this product is added
    // to the cart automatically as soon as a visitor opens the page.
    autoCart: { type: Boolean, default: false },
  },
  { _id: false }
);

const shortLandingPageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    title2: { type: String, default: '' },
    image: { type: String, default: null },
    status: { type: Boolean, default: true },

    items: [shortLandingItemSchema],

    // -- Delivery Settings --
    deliveryChargeMode: { type: String, enum: ['required', 'optional', 'free'], default: 'required' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ShortLandingPage', shortLandingPageSchema);
