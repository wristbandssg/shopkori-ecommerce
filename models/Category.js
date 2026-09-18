const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    image: { type: String, default: null },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    sortOrder: { type: Number, default: 0 },
    status: { type: Boolean, default: true },

    // -- SEO content blocks for the storefront category page --
    // pageTitle: the big on-page heading (e.g. "Face Cream Online BD |
    // Moisturizer Care | ShopKori") — falls back to `name` when blank.
    // shortDescription: a short (~150-word) intro shown under the
    // breadcrumb, above the product grid.
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

module.exports = mongoose.model('Category', categorySchema);
