const mongoose = require('mongoose');

/**
 * A support ticket raised by an Admin from Admin > Help & Support's
 * "Create Support Ticket" card. There's no live ShopKori support-agent
 * backend in this app to actually answer it, so this is a real, saved
 * record any admin can see and mark Resolved — a shared internal log of
 * "what we asked ShopKori support and whether it's settled" rather than
 * a live two-way conversation (that's what the Live Chat / Call / Email
 * cards are for instead).
 */
const supportTicketSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
