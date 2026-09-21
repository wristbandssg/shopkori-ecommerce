const mongoose = require('mongoose');

/**
 * Task Management — a general internal to-do/task tracker for admin staff
 * (Admin > Task Management). It is intentionally NOT wired into the real
 * order pipeline:
 *  - `orderStatus` reuses the same value strings as the order pipeline's
 *    ORDER_STATUSES list (middleware/orderConstants.js) so the "Order
 *    Status" dropdown here looks and reads identically to the one on real
 *    orders, but it is just a manually-picked tag on the task — it is
 *    never read from or written back to any actual Order document.
 *  - `invoiceNumber` is free text. It is NOT validated against, or
 *    auto-filled from, Order.orderNumber — the reference design shows no
 *    lookup/auto-fill behavior linking it to the Order Status field, so
 *    staff type it in manually (e.g. to note which order a task relates
 *    to for their own reference).
 *  - `employee` ("Employee Name"/assigned user) IS a real link into the
 *    Admin collection — the same staff accounts used everywhere else
 *    (Staff > User, Order assignment, Manage Delivery).
 *
 * The `priority`/`status`/`type` option lists below are an original,
 * disclosed design choice: the reference screenshot's "Add Task" modal
 * only showed each dropdown's single default selection, not its full set
 * of options, so a reasonable small set was chosen for each.
 */

const TASK_PRIORITIES = [
  { value: 'low', label: 'Low', badge: 'secondary' },
  { value: 'medium', label: 'Medium', badge: 'warning' },
  { value: 'high', label: 'High', badge: 'danger' },
];

const TASK_STATUSES = [
  { value: 'pending', label: 'Pending', badge: 'secondary' },
  { value: 'in_progress', label: 'In Progress', badge: 'info' },
  { value: 'completed', label: 'Completed', badge: 'success' },
];

const TASK_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'order', label: 'Order' },
  { value: 'support', label: 'Support' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'other', label: 'Other' },
];

function findIn(list, value) {
  return list.find((x) => x.value === value) || null;
}

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    priority: { type: String, enum: TASK_PRIORITIES.map((p) => p.value), default: 'medium' },
    status: { type: String, enum: TASK_STATUSES.map((s) => s.value), default: 'pending' },
    type: { type: String, enum: TASK_TYPES.map((t) => t.value), default: 'general' },
    // Manually-picked tag, not a live Order lookup — see file comment above.
    orderStatus: { type: String, default: '' },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    // Free text, not validated against Order.orderNumber — see file comment above.
    invoiceNumber: { type: String, default: '', trim: true },
    dueDate: { type: Date, default: null },
  },
  { timestamps: true },
);

const TaskModel = mongoose.model('Task', taskSchema);

module.exports = {
  TaskModel,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  priorityLabel: (v) => (findIn(TASK_PRIORITIES, v) || {}).label || v,
  priorityBadge: (v) => (findIn(TASK_PRIORITIES, v) || {}).badge || 'secondary',
  taskStatusLabel: (v) => (findIn(TASK_STATUSES, v) || {}).label || v,
  taskStatusBadge: (v) => (findIn(TASK_STATUSES, v) || {}).badge || 'secondary',
  typeLabel: (v) => (findIn(TASK_TYPES, v) || {}).label || v,
};
