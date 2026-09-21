const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: { type: String, default: '' },
    content: { type: String, default: '' },
    coverImage: { type: String, default: null },
    coverImageAlt: { type: String, default: '' }, // alt text for the cover image (SEO + accessibility)
    category: { type: String, default: '', trim: true },
    tags: [{ type: String, trim: true }],
    status: { type: Boolean, default: true }, // true = published, false = draft
    // `status` stays the single boolean the storefront query already filters
    // on ("is this post visible right now"). `publishStatus` + `publishAt`
    // are the admin-facing Draft/Published/Schedule controls that drive it —
    // kept in sync in routes/admin.js (saveBlogPost), same pattern as
    // models/Product.js. server.js has a matching background job that flips
    // a due 'scheduled' post over to 'published'/status:true.
    publishStatus: { type: String, enum: ['draft', 'published', 'scheduled'], default: 'published' },
    publishAt: { type: Date, default: null },
    metaTitle: { type: String, default: '' },
    metaKeywords: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlogPost', blogPostSchema);
