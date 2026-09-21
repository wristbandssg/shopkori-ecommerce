const mongoose = require('mongoose');

/**
 * A staff Role: a name plus a permission matrix (see the "Assign
 * Permission to Roles" table in views/admin/staff-role-form.ejs).
 * `permissions` is sparse: only modules/actions the admin actually
 * checked are stored, as { <moduleKey>: ['manage', 'create', ...] }.
 *
 * IMPORTANT — SAVE-ONLY beyond login: this permission matrix is genuinely
 * created, edited and persisted here, and models/Admin.js's `roleId`
 * really links a staff account to one of these roles. But nothing in this
 * app's ~150 other admin routes actually CHECKS these permissions yet —
 * enforcing "can this logged-in staff account create a product" on every
 * single admin route is a much bigger job than this screenshot asked for,
 * so it's honestly left undone rather than faked. The one access-control
 * piece that IS real and enforced is a separate, simpler mechanism:
 * Admin.loginEnabled (see models/Admin.js's login route), which really
 * blocks a disabled staff account from logging in at all.
 */
const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', actions: ['manage'] },
  { key: 'storeAnalytics', label: 'Store Analytics', actions: ['manage'] },
  { key: 'orders', label: 'Orders', actions: ['manage', 'delete', 'show'] },
  { key: 'role', label: 'Role', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'user', label: 'User', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'pos', label: 'Pos', actions: ['manage', 'create'] },
  { key: 'products', label: 'Products', actions: ['manage', 'create', 'edit', 'delete', 'show'] },
  { key: 'store', label: 'Store', actions: ['manage', 'create'] },
  { key: 'variants', label: 'Variants', actions: ['create', 'edit', 'delete'] },
  { key: 'productCategory', label: 'Product category', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'productTax', label: 'Product Tax', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'rating', label: 'Ratting', actions: ['create', 'edit', 'delete'] },
  { key: 'productCoupon', label: 'Product Coupan', actions: ['manage', 'create', 'edit', 'delete', 'show'] },
  { key: 'subscriber', label: 'Subscriber', actions: ['manage', 'create', 'delete'] },
  { key: 'shipping', label: 'Shipping', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'customPage', label: 'Custom Page', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'blog', label: 'Blog', actions: ['manage', 'create', 'edit', 'delete'] },
  { key: 'customers', label: 'Customers', actions: ['manage', 'show'] },
  { key: 'plans', label: 'Plans', actions: ['manage'] },
  { key: 'settings', label: 'Settings', actions: ['manage'] },
  { key: 'themes', label: 'Themes', actions: ['manage', 'edit'] },
  { key: 'resetPassword', label: 'Reset Password', actions: ['resetPassword'] },
  { key: 'changeStore', label: 'Change Store', actions: ['manage'] },
];

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const RoleModel = mongoose.model('Role', roleSchema);

module.exports = { RoleModel, PERMISSION_MODULES };
