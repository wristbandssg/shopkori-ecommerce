const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Supplier', supplierSchema);
