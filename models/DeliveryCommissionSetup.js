const mongoose = require('mongoose');

/**
 * A volume-based commission tier for one delivery employee (Admin >
 * Manage Delivery > Delivery Commission). "employee" is always an Admin
 * account — the same convention Order.assignedEmployee / Order.delivery
 * .deliveryMan already use (see Admin > Staff).
 *
 * Once the employee crosses `afterCancelCount` cancelled orders, or
 * `afterDeliveredCount` delivered orders, in a period, the matching flat
 * commission-per-order rate applies. This table only defines the rates —
 * an employee's actual payout is requested separately (Admin > Manage
 * Delivery > Commission Request) and approved by the office.
 */
const deliveryCommissionSetupSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    afterCancelCount: { type: Number, default: 0 },
    commissionAfterCancel: { type: Number, default: 0 },
    afterDeliveredCount: { type: Number, default: 0 },
    commissionAfterDelivered: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryCommissionSetup', deliveryCommissionSetupSchema);
