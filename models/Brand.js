const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    image: { type: String, default: null }, // logo — shown next to the name and on product filters
    bannerImage: { type: String, default: null }, // wide banner shown at the top of the storefront brand page
    sortOrder: { type: Number, default: 0 },
    status: { type: Boolean, default: true },

    // -- SEO content blocks for the storefront brand page (/brand/:slug) --
    // Same shape as Category's content fields, so a brand page reads and
    // ranks the same way a category page does.
    // pageTitle: the big on-page heading — falls back to `name` when blank.
    // shortDescription: a short (~150-word) intro shown under the brand
    // name, above the product grid.
    // description: a longer SEO content block (rich text, same custom
    // editor as a product's Long Description) shown below the grid.
    pageTitle: { type: String, default: '' },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    metaTitle: { type: String, default: '' },
    metaKeywords: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Brand', brandSchema);
