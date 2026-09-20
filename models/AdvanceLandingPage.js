const mongoose = require('mongoose');

/**
 * "Advance Landing" pages — the richest of the four Landing Page types.
 * On top of a banner and background styling, the page body is built from
 * one or more repeatable "Design" blocks (Add Design / + Add More Design in
 * the reference UI), each an independent product-picker section with its
 * own design type, product-select mode, instruction message and colour
 * styling — so a single page can stack multiple differently-styled product
 * sections one after another.
 */
const advanceDesignProductSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    // "Is Auto Cart" — added to the cart automatically as soon as a visitor
    // opens the page.
    autoCart: { type: Boolean, default: false },
    // "Best Sale" — flags this product as a highlighted pick within this
    // design block.
    bestSale: { type: Boolean, default: false },
  },
  { _id: false }
);

// Layout templates offered by "Select Design Type" — kept as a simple enum
// list rather than a separate collection, since there is no admin UI shown
// for managing design types themselves.
const DESIGN_TYPES = ['slider', 'grid', 'list', 'highlight'];

const advanceDesignBlockSchema = new mongoose.Schema(
  {
    designType: { type: String, enum: [...DESIGN_TYPES, ''], default: '' },
    // "User Can Select Only 1 Product" / "User Can Select Multiple Product"
    productSelectMode: { type: String, enum: ['single', 'multiple'], default: 'multiple' },
    products: [advanceDesignProductSchema],
    instructionMessage: { type: String, default: '' },
    messageOnOff: { type: Boolean, default: false },
    showNumber: { type: Boolean, default: false },
    productBgColor: { type: String, default: '#ffffff' },
    productBorderColor: { type: String, default: '#c0554e' },
  },
  { _id: false }
);

const advanceLandingPageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    status: { type: Boolean, default: true },

    // -- Top row toggles --
    buttonEffect: { type: Boolean, default: false },
    showLogo: { type: Boolean, default: false },
    showTopCountdown: { type: Boolean, default: false },
    showVoice: { type: Boolean, default: false },

    // -- Background --
    backgroundEnabled: { type: Boolean, default: true },
    backgroundColor: { type: String, default: '#ffffff' },
    backgroundEffect: { type: Boolean, default: false },

    // -- Banner --
    bannerEnabled: { type: Boolean, default: true },
    bannerImage: { type: String, default: null },

    // -- Add Design --
    designEnabled: { type: Boolean, default: true },
    designs: [advanceDesignBlockSchema],

    // -- Delivery Settings --
    deliveryChargeMode: { type: String, enum: ['required', 'optional', 'free'], default: 'required' },

    // -- Payment Methods --
    paymentCod: { type: Boolean, default: true },
    paymentBkash: { type: Boolean, default: false },
    paymentManual: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdvanceLandingPage', advanceLandingPageSchema);
module.exports.DESIGN_TYPES = DESIGN_TYPES;
