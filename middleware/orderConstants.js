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

function statusLabel(value) {
  const found = ORDER_STATUSES.find((s) => s.value === value);
  return found ? found.label : value;
}

function statusBadge(value) {
  const found = ORDER_STATUSES.find((s) => s.value === value);
  return found ? found.badge : 'secondary';
}

module.exports = { ORDER_STATUSES, COURIERS, statusLabel, statusBadge };
