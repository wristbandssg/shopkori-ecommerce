const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    image: { type: String, default: null },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Brand', brandSchema);
