const mongoose = require('mongoose');

/**
 * A real Blog Category — created/edited from Admin > Blog > Categories,
 * the same way models/Category.js works for products. Previously (see
 * models/BlogPost.js's git history) a blog post's "category" was just a
 * free-text string with an autocomplete datalist; this replaces that with
 * a proper collection so each category can have its own SEO-able page
 * (pageTitle/shortDescription/description/metaTitle/metaKeywords/
 * metaDescription — same fields models/Category.js uses for the
 * storefront /category/:slug page) at /blog/category/:slug.
 */
const blogCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    image: { type: String, default: null },
    imageAlt: { type: String, default: '' }, // alt text for the image (SEO + accessibility)
    sortOrder: { type: Number, default: 0 },

    // `status` stays the single boolean the storefront query already filters
    // on ("is this category visible right now"). `publishStatus` + `publishAt`
    // are the admin-facing Draft/Publish/Schedule controls — same pattern as
    // models/Product.js and models/BlogPost.js — and server.js's
    // publishDueScheduledBlogCategories job flips status:true itself once a
    // due 'scheduled' category's publishAt time arrives.
    status: { type: Boolean, default: true },
    publishStatus: { type: String, enum: ['draft', 'published', 'scheduled'], default: 'published' },
    publishAt: { type: Date, default: null },

    // -- SEO content blocks for the storefront /blog/category/:slug page --
    // Same shape as models/Category.js: pageTitle is the big on-page
    // heading (falls back to `name`), shortDescription is a short intro
    // shown above the post list, description is a longer SEO write-up
    // shown below it.
    pageTitle: { type: String, default: '' },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    metaTitle: { type: String, default: '' },
    metaKeywords: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlogCategory', blogCategorySchema);
