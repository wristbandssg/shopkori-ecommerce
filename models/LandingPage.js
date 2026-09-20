const mongoose = require('mongoose');

/**
 * "Main Landing" pages — standalone, shareable product-promo pages built
 * from the admin panel (Manage Product / Landing Page / Main Landing). Each
 * one is a self-contained mini storefront: a banner + slider, an
 * instruction/description block, a set of highlighted products, a
 * "Customer Review" gallery tied to specific products, and its own order
 * button + delivery/payment rules — independent of the main storefront's
 * global settings, so a campaign page can offer e.g. COD-only + free
 * delivery while the main site still takes bKash.
 */
const youtubeVideoSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    link: { type: String, default: '' },
  },
  { _id: false }
);

// A repeatable "Title + Value" row built with the "+ Add To Description"
// button — rendered as extra spec/feature rows under the product description.
const descriptionBlockSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    value: { type: String, default: '' },
  },
  { _id: false }
);

const reviewProductSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // "Is Auto Cart" in the admin table — when true, this product is added
    // to the cart automatically as soon as a visitor opens the landing page.
    autoCart: { type: Boolean, default: false },
  },
  { _id: false }
);

const landingPageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    status: { type: Boolean, default: true },

    mainBanner: { type: String, default: null },

    sliderTitle: { type: String, default: '' },
    sliderImages: [{ type: String }],
    sliderView: { type: String, enum: ['slide', 'grid'], default: 'slide' },

    instructionMessage: { type: String, default: '' },

    // "UI/UX" toggle in the reference design — switches the page between the
    // classic layout and a more modern one.
    modernUi: { type: Boolean, default: false },
    showNumber: { type: Boolean, default: true },
    // Products Layout toggle — on = grid, off = list.
    productsLayoutGrid: { type: Boolean, default: true },

    contactTitle: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    orderButtonText: { type: String, default: 'Order Now' },
    orderButtonTextColor: { type: String, default: '#ffffff' },
    orderButtonBgColor: { type: String, default: '#e74c3c' },

    youtubeVideos: [youtubeVideoSchema],
    descriptionBlocks: [descriptionBlockSchema],

    // -- Customer Review section --
    reviewSectionTitle: { type: String, default: '' },
    reviewImages: [{ type: String }],
    reviewView: { type: String, enum: ['slide', 'grid'], default: 'slide' },
    reviewProductSelectMode: { type: String, enum: ['single', 'multiple'], default: 'multiple' },
    reviewProducts: [reviewProductSchema],

    // -- Title Setting --
    titleColor: { type: String, default: '#1e3a5f' },
    titleIconColor: { type: String, default: '#d4a537' },

    // -- Delivery Settings --
    deliveryChargeMode: { type: String, enum: ['required', 'optional', 'free'], default: 'required' },

    // -- Payment Methods --
    paymentCod: { type: Boolean, default: true },
    paymentBkash: { type: Boolean, default: false },
    paymentManual: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LandingPage', landingPageSchema);
