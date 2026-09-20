const mongoose = require('mongoose');

/**
 * Delivery Charge (Settings > Delivery Charge). A "delivery type" is just a
 * named location/zone ("Add Delivery Type"); a delivery rate is that same
 * zone's shipping charge ("Add Delivery Rate", set separately so a zone can
 * exist before it has a price). The admin page renders this one collection
 * as two tables — Delivery Locations (all zones) and Delivery Rate (their
 * prices, "Not set" until priced).
 */
const deliveryZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    rate: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryZone', deliveryZoneSchema);
