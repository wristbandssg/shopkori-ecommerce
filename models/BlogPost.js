const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: { type: String, default: '' },
    content: { type: String, default: '' },
    coverImage: { type: String, default: null },
    status: { type: Boolean, default: true }, // true = published, false = draft
  },
  { timestamps: true }
);

module.exports = mongoose.model('BlogPost', blogPostSchema);
