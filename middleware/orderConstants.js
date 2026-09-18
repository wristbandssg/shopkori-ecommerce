/**
 * Shared order status / courier lists used by both the admin routes and
 * the admin views, so the two never drift out of sync. `badge` is a
 * Bootstrap color used for the status pill.
 */
const ORDER_STATUSES = [
  { value: 'pending', label: 'New Order', badge: 'secondary' },
  { value: 'confirmed', label: 'Confirmed', badge: 'info' },
  { value: 'packaging', label: 'Packaging', badge: 'primary' },
  { value: 'courier', label: 'Courier', badge: 'primary' },
  { value: 'delivered', label: 'Delivered', badge: 'success' },
  { value: 'cancelled', label: 'Cancelled', badge: 'danger' },
  { value: 'follow_up', label: 'Follow Up', badge: 'warning' },
  { value: 'ask_advance', label: 'Ask Advance', badge: 'warning' },
  { value: 'good_no_received', label: 'Good No Received', badge: 'danger' },
  { value: 'no_received', label: 'No Received', badge: 'danger' },
  { value: 'hold', label: 'Hold', badge: 'secondary' },
  { value: 'returned', label: 'Returned', badge: 'dark' },
  { value: 'delivery_issue', label: 'Delivery Issue', badge: 'danger' },
  { value: 'stock_out', label: 'Stock Out', badge: 'dark' },
];

const COURIERS = [
  { value: '', label: '-- Not assigned --' },
  { value: 'pathao', label: 'Pathao' },
  { value: 'steadfast', label: 'Steadfast' },
  { value: 'redx', label: 'RedX' },
  { value: 'other', label: 'Other' },
];

// Admin > Manage Delivery > Delivery Man tabs — an order's own physical
// hand-off journey through an in-house rider, tracked on Order.delivery.status
// (see models/Order.js). Separate from the business-level ORDER_STATUSES
// above and from the 3rd-party COURIERS list.
const DELIVERY_STATUSES = [
  { value: 'pending', label: 'Pending', badge: 'secondary' },
  { value: 'picked', label: 'Picked', badge: 'info' },
  { value: 'received', label: 'Received', badge: 'primary' },
  { value: 'assigned', label: 'Assigned', badge: 'primary' },
  { value: 'out_for_delivery', label: 'Out for Delivery', badge: 'warning' },
  { value: 'customer_not_available', label: 'Customer Not Available', badge: 'danger' },
  { value: 'hold', label: 'Hold', badge: 'dark' },
];

// Admin > Manage Delivery > Cancelled Order / Return Confirm tabs — the
// journey of a cancelled order's product physically coming back to the
// office, tracked on Order.delivery.returnStatus.
const RETURN_STATUSES = [
  { value: 'return_pending', label: 'Return Pending', badge: 'warning' },
  { value: 'return_sending', label: 'Return Sending', badge: 'info' },
  { value: 'return_received', label: 'Return Received', badge: 'success' },
];

function statusLabel(value) {
  const found = ORDER_STATUSES.find((s) => s.value === value);
  return found ? found.label : value;
}

function statusBadge(value) {
  const found = ORDER_STATUSES.find((s) => s.value === value);
  return found ? found.badge : 'secondary';
}

function deliveryStatusLabel(value) {
  const found = DELIVERY_STATUSES.find((s) => s.value === value);
  return found ? found.label : value;
}

function deliveryStatusBadge(value) {
  const found = DELIVERY_STATUSES.find((s) => s.value === value);
  return found ? found.badge : 'secondary';
}

function returnStatusLabel(value) {
  const found = RETURN_STATUSES.find((s) => s.value === value);
  return found ? found.label : value;
}

function returnStatusBadge(value) {
  const found = RETURN_STATUSES.find((s) => s.value === value);
  return found ? found.badge : 'secondary';
}

module.exports = {
  ORDER_STATUSES, COURIERS, statusLabel, statusBadge,
  DELIVERY_STATUSES, RETURN_STATUSES,
  deliveryStatusLabel, deliveryStatusBadge, returnStatusLabel, returnStatusBadge,
};
