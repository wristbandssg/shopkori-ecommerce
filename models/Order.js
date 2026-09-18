const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, required: true },
    productImage: { type: String, default: null },
    price: { type: Number, required: true },
    qty: { type: Number, required: true, default: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

const activityLogSchema = new mongoose.Schema(
  { message: { type: String, required: true }, at: { type: Date, default: Date.now } },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: '' },
    customerPhone: { type: String, required: true },
    shippingAddress: { type: String, required: true },
    shippingCity: { type: String, default: '' },
    notes: { type: String, default: '' },
    items: [orderItemSchema],
    subtotal: { type: Number, required: true, default: 0 },
    shippingFee: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
    paymentMethod: { type: String, enum: ['cod', 'bkash', 'sslcommerz'], default: 'cod' },
    paymentStatus: { type: String, enum: ['unpaid', 'pending', 'paid', 'failed', 'cancelled'], default: 'unpaid' },
    transactionId: { type: String, default: null },

    // Full clickdokan-style order pipeline. 'pending'/'processing'/'shipped'
    // are kept in the enum so any pre-existing rows stay valid; new orders
    // move through the granular set below (see middleware/orderConstants.js
    // for the admin-facing labels).
    status: {
      type: String,
      enum: [
        'pending', 'processing', 'shipped', // legacy
        'confirmed', 'packaging', 'courier', 'delivered', 'cancelled',
        'follow_up', 'ask_advance', 'good_no_received', 'no_received', 'hold',
        'returned', 'delivery_issue', 'stock_out',
      ],
      default: 'pending',
    },

    // -- Order Management additions --
    courier: { type: String, enum: ['', 'pathao', 'steadfast', 'redx', 'other'], default: '' },
    courierTrackingId: { type: String, default: '' },
    assignedEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    adminNote: { type: String, default: '' },
    source: { type: String, default: 'website' }, // website | manual
    activityLog: [activityLogSchema],

    // Soft delete (Deleted Orders / restore)
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    // Incomplete Orders: online-payment checkouts that were started but
    // never confirmed as paid (see routes/admin.js /orders/incomplete).
    incompleteStatus: { type: String, enum: ['new', 'cancelled', 'hold'], default: 'new' },

    // Returned Orders: Not Received / Received tab
    returnReceived: { type: Boolean, default: false },

    // Delivery Issue Orders tab
    deliveryIssueStatus: { type: String, enum: ['unsolved', 'solved', 'cancel', 'partially_return'], default: 'unsolved' },

    // Missed Orders / After Confirm Order reporting
    confirmedAt: { type: Date, default: null },
    wasMissed: { type: Boolean, default: false },

    // Captured at checkout for the Same IP / Same Number / Same Cookie
    // limit enforcement in Order Setting.
    ip: { type: String, default: '' },
    trackToken: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
