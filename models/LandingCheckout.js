const mongoose = require('mongoose');

/**
 * "Landing Checkout" pages — a standalone checkout-style landing page built
 * around a short product picker (unlike Main/Short Landing's richer
 * banner/slider layouts). Controls how many products a visitor can pick
 * (single vs multiple) and whether picking one is mandatory before they can
 * proceed ("Instant Select Required"), plus a per-product Auto Cart / Best
 * Sell flag shown on the picker.
 */
const checkoutItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    // "Is Auto Cart" — added to the cart automatically as soon as a visitor
    // opens the page.
    autoCart: { type: Boolean, default: false },
    // "Best Sell" — flags this product as a highlighted "Best Seller" pick
    // on the checkout page's product picker.
    bestSell: { type: Boolean, default: false },
  },
  { _id: false }
);

const landingCheckoutSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    status: { type: Boolean, default: true },

    // "User Can Select Only 1 Product" / "User Can Select Multiple Product"
    productSelectMode: { type: String, enum: ['single', 'multiple'], default: 'multiple' },
    // "Instant Select Required?" — when true, a visitor must pick a product
    // before they can proceed with the checkout.
    instantSelectRequired: { type: Boolean, default: false },

    items: [checkoutItemSchema],

    // -- Delivery Settings --
    deliveryChargeMode: { type: String, enum: ['required', 'optional', 'free'], default: 'required' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LandingCheckout', landingCheckoutSchema);
