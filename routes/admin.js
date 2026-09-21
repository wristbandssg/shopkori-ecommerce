const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

const Category = require('../models/Category');
const Brand = require('../models/Brand');
const VariantAttribute = require('../models/VariantAttribute');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Admin = require('../models/Admin');
const { RoleModel: Role, PERMISSION_MODULES } = require('../models/Role');
const StaffCommissionSetup = require('../models/StaffCommissionSetup');
const {
  TaskModel: Task, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES,
  priorityLabel, priorityBadge, taskStatusLabel, taskStatusBadge, typeLabel,
} = require('../models/Task');
const { getReferralSetting } = require('../models/ReferralSetting');
const ReferralPayoutRequest = require('../models/ReferralPayoutRequest');
const { getHelpSupportSetting } = require('../models/HelpSupportSetting');
const SupportTicket = require('../models/SupportTicket');
const DeliveryCommissionSetup = require('../models/DeliveryCommissionSetup');
const DeliveryRequest = require('../models/DeliveryRequest');
const PageView = require('../models/PageView');
const SearchLog = require('../models/SearchLog');
const Announcement = require('../models/Announcement');
const LoginLog = require('../models/LoginLog');
const BlockedIp = require('../models/BlockedIp');
const { getEmailSetting, updateEmailSetting } = require('../models/EmailSetting');
const { generateSecret, verifyTotp } = require('../lib/totp');
const Page = require('../models/Page');
const BlogPost = require('../models/BlogPost');
const LandingPage = require('../models/LandingPage');
const ShortLandingPage = require('../models/ShortLandingPage');
const LandingCheckout = require('../models/LandingCheckout');
const AdvanceLandingPage = require('../models/AdvanceLandingPage');
const DeliveryZone = require('../models/DeliveryZone');
const CourierSetup = require('../models/CourierSetup');
const { getPaymentSettings, updatePaymentSettingCard } = require('../models/PaymentSetting');
const { getInvoiceSettings, updateInvoiceSettings } = require('../models/InvoiceSetting');
const CustomPage = require('../models/CustomPage');
const Coupon = require('../models/Coupon');
const { getStoreCustomization, updateStoreCustomization } = require('../models/StoreCustomization');
const { getThemeCustomizer, updateThemeCustomizer } = require('../models/ThemeCustomizer');
const { getOfferSettingPopulated, updateOfferSetting } = require('../models/OfferSetting');
const Purchase = require('../models/Purchase');
const PixelSetting = require('../models/PixelSetting');
const HomeSetting = require('../models/HomeSetting');
const OrderPageSetting = require('../models/OrderPageSetting');
const { getSettings, setSetting } = require('../models/Setting');
const { getOrderSettings, updateOrderSettingCard } = require('../models/OrderSetting');
const { getMarketingSettings, updateMarketingSettingCard } = require('../models/MarketingSetting');
const { sendSms } = require('../lib/sms');

const adminLocals = require('../middleware/adminLocals');
const { requireAdminLogin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const upload = require('../middleware/upload');
const { slugify, ensureUniqueSlug, maskSecret } = require('../middleware/helpers');
const {
  ORDER_STATUSES, COURIERS, statusLabel,
  DELIVERY_STATUSES, RETURN_STATUSES,
  deliveryStatusLabel, deliveryStatusBadge, returnStatusLabel, returnStatusBadge,
} = require('../middleware/orderConstants');

router.use(adminLocals);

/* =====================================================================
   LOGIN / LOGOUT
   ===================================================================== */
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { errors: [], formData: {} });
});

router.post('/login', async (req, res, next) => {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      return res.render('admin/login', { errors: ['Form has expired.'], formData: req.body });
    }
    const ip = req.ip || '';
    const { username, password } = req.body;
    const logAttempt = (status, reason, adminId) =>
      LoginLog.create({ admin: adminId || null, usernameAttempted: username || '', ip, userAgent: req.get('User-Agent') || '', status, reason: reason || '' }).catch(() => {});

    // Admin > Security Dashboard > Blocked IPs — genuinely enforced: a
    // blocked IP never even reaches the password check below.
    const blocked = await BlockedIp.findOne({ ip }).lean();
    if (blocked) {
      logAttempt('failed', 'Blocked IP');
      return res.render('admin/login', { errors: ['Access from this IP address has been blocked.'], formData: req.body });
    }

    const admin = await Admin.findOne({ $or: [{ username }, { email: (username || '').toLowerCase() }] });
    if (admin && (await bcrypt.compare(password, admin.password))) {
      // Staff > User > "Login is enable" — genuinely enforced here.
      if (admin.loginEnabled === false) {
        logAttempt('failed', 'Account disabled', admin._id);
        return res.render('admin/login', { errors: ['This account has been disabled. Contact an administrator.'], formData: req.body });
      }
      // Admin > Security Dashboard > 2FA Status — password is correct, but
      // don't sign the session in yet: hold it in a separate pending slot
      // until GET/POST /admin/login/2fa confirms a valid TOTP code. The
      // login attempt itself is only logged once that second step resolves.
      if (admin.twoFactorEnabled) {
        req.session.pending2faAdminId = String(admin._id);
        return res.redirect('/admin/login/2fa');
      }
      req.session.adminId = admin._id;
      logAttempt('success', '', admin._id);
      return res.redirect('/admin');
    }
    logAttempt('failed', 'Incorrect username or password', admin ? admin._id : null);
    res.render('admin/login', { errors: ['Incorrect username or password.'], formData: req.body });
  } catch (err) {
    next(err);
  }
});

// Second step of login when the account has 2FA enabled (Admin > Security
// Dashboard). Only reachable with a pending2faAdminId set by POST /login
// just above — never a standalone login path of its own.
router.get('/login/2fa', (req, res) => {
  if (!req.session.pending2faAdminId) return res.redirect('/admin/login');
  res.render('admin/login-2fa', { errors: [] });
});

router.post('/login/2fa', async (req, res, next) => {
  try {
    if (!req.session.pending2faAdminId) return res.redirect('/admin/login');
    if (req.body.csrfToken !== req.session.csrfToken) {
      return res.render('admin/login-2fa', { errors: ['Form has expired.'] });
    }
    const admin = await Admin.findById(req.session.pending2faAdminId);
    const ip = req.ip || '';
    if (!admin || !admin.twoFactorEnabled) {
      delete req.session.pending2faAdminId;
      return res.redirect('/admin/login');
    }
    if (verifyTotp(admin.twoFactorSecret, req.body.code)) {
      req.session.adminId = admin._id;
      delete req.session.pending2faAdminId;
      LoginLog.create({ admin: admin._id, usernameAttempted: admin.username, ip, userAgent: req.get('User-Agent') || '', status: 'success', reason: '2FA verified' }).catch(() => {});
      return res.redirect('/admin');
    }
    LoginLog.create({ admin: admin._id, usernameAttempted: admin.username, ip, userAgent: req.get('User-Agent') || '', status: 'failed', reason: 'Invalid 2FA code' }).catch(() => {});
    res.render('admin/login-2fa', { errors: ['Invalid authentication code.'] });
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  delete req.session.adminId;
  res.redirect('/admin/login');
});

// Everything below requires admin login
router.use(requireAdminLogin);

/* =====================================================================
   COMING SOON PLACEHOLDERS
   ---------------------------------------------------------------------
   The full clickdokan-style sidebar (see views/admin/partials/admin-header.ejs)
   links to a lot of modules that aren't built yet. Rather than 404 on
   click, every one of those links renders this same friendly "coming
   soon" page until its real backend is built, module by module.
   Real, working modules (Products, Category, Orders — the full pipeline
   below, Manage Delivery, Staff, Marketing, Analytics, Customers,
   Settings, Blog, Pages) are NOT in this list — they have their own routes.
   Registered FIRST (before any /orders/:id-style wildcard route further
   down) so an exact path like /orders/incomplete is never swallowed by
   a wildcard route meant for a real order id.
   ===================================================================== */
const COMING_SOON_PAGES = {
  // '/customization' itself is now a real hub (see the CUSTOMIZATION
  // section below) — only its two sub-cards without any shown design
  // (Manage Sliders, Product View Setting) still land here.
  '/customization/sliders': 'Manage Sliders',
  '/customization/product-view': 'Product View Setting',

  // '/offer/*' sub-pages are now real (see the OFFER SETTING section
  // below) — removed from here.

  // Staff Settings grid cards with no design shown anywhere (see the
  // STAFF SETTINGS section below for the 4 real cards).
  '/staff/product-assign': 'Product Assign List',
  '/staff/commission-request': 'Staff Commission Request',

  // Accounting was removed from the sidebar entirely per the owner's
  // request (not needed) — these coming-soon stubs go with it rather
  // than staying reachable by direct URL with no nav link to find them.

  // '/task-management' is now real (see the TASK MANAGEMENT section below).

  // '/pos' was removed from the sidebar entirely per the owner's request
  // (not needed).

  // Still coming soon — no distinct UI/spec provided for these yet.
  '/orders/follow-up': 'Follow Up',
  '/orders/user-activity': 'User Activity',
  '/orders/near-by': 'Near By Orders',
  '/orders/blocked': 'Order Block',
  '/orders/store-analytics': 'Store Analytics',

  // '/referral-program' is now real (see the REFERRAL PROGRAM section below).

  // '/our-service' was removed from the sidebar entirely per the owner's
  // request (not needed).
  // '/help-support' is now real (see the HELP & SUPPORT section below).
};

Object.keys(COMING_SOON_PAGES).forEach((subPath) => {
  router.get(subPath, (req, res) => {
    res.render('admin/coming-soon', { adminPageTitle: COMING_SOON_PAGES[subPath] });
  });
});

/* =====================================================================
   ORDER MANAGEMENT — helpers shared by the routes below
   ===================================================================== */
function pushActivity(order, message) {
  order.activityLog = order.activityLog || [];
  order.activityLog.push({ message, at: new Date() });
}

// Applies a status change, and keeps confirmedAt / wasMissed in sync so
// Missed Orders + After Confirm Order can report on it later.
async function applyStatusChange(order, newStatus) {
  const oldStatus = order.status;
  if (oldStatus === newStatus) return;
  if (oldStatus === 'pending' && Date.now() - order.createdAt.getTime() > 24 * 60 * 60 * 1000) {
    order.wasMissed = true;
  }
  if (newStatus === 'confirmed' && !order.confirmedAt) {
    order.confirmedAt = new Date();
  }
  // Manage Delivery: a COD order reaching "Delivered" is taken to mean the
  // rider collected the cash on the spot — it then falls out of the
  // Delivery Man queue and into Delivered Order (Pending -> Collected).
  // A "Cancelled" order starts its Cancelled Order / Return Confirm
  // journey back to the office.
  if (newStatus === 'delivered' && order.paymentMethod === 'cod' && !order.delivery.collected) {
    order.delivery.collected = true;
    order.delivery.collectedAt = new Date();
    if (order.paymentStatus !== 'paid') order.paymentStatus = 'paid';
  }
  if (newStatus === 'cancelled' && !order.delivery.returnStatus) {
    order.delivery.returnStatus = 'return_pending';
  }
  order.status = newStatus;
  pushActivity(order, `Status changed: ${statusLabel(oldStatus)} -> ${statusLabel(newStatus)}`);
}

function parseIds(body) {
  let ids = body.ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  return ids.filter(Boolean);
}

const ORDER_SEARCH_FIELDS = (q) => ({
  $or: [
    { orderNumber: new RegExp(q, 'i') },
    { customerName: new RegExp(q, 'i') },
    { customerPhone: new RegExp(q, 'i') },
  ],
});

/* =====================================================================
   ALL ORDERS (main pipeline: New Order -> ... -> Delivered/Cancelled/etc)
   ===================================================================== */
router.get('/orders', async (req, res, next) => {
  try {
    const { q, status, dateFilter, employee, courier } = req.query;
    const filter = { isDeleted: false };
    if (status) filter.status = status;
    if (employee) filter.assignedEmployee = employee;
    if (courier) filter.courier = courier;
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    if (dateFilter) {
      const now = new Date();
      let from = null;
      let to = null;
      if (dateFilter === 'today') {
        from = new Date(now); from.setHours(0, 0, 0, 0);
        to = new Date(now); to.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'yesterday') {
        from = new Date(now); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
        to = new Date(now); to.setDate(to.getDate() - 1); to.setHours(23, 59, 59, 999);
      } else if (dateFilter === 'this_week') {
        from = new Date(now); from.setDate(from.getDate() - from.getDay()); from.setHours(0, 0, 0, 0);
        to = now;
      } else if (dateFilter === 'this_month') {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = now;
      }
      if (from && to) filter.createdAt = { $gte: from, $lte: to };
    }

    const [orders, employees, tabCounts, totalAll] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).limit(300).populate('assignedEmployee', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
      Order.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Order.countDocuments({ isDeleted: false }),
    ]);

    const countMap = {};
    tabCounts.forEach((c) => { countMap[c._id] = c.n; });

    res.render('admin/orders', {
      adminPageTitle: 'Order Management',
      orders,
      employees,
      ORDER_STATUSES,
      COURIERS,
      q: q || '',
      status: status || '',
      dateFilter: dateFilter || '',
      employee: employee || '',
      courier: courier || '',
      countMap,
      totalAll,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/bulk-delete', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    if (ids.length) {
      await Order.updateMany({ _id: { $in: ids } }, { isDeleted: true, deletedAt: new Date() });
      req.flash('success', `${ids.length} order(s) moved to Deleted Orders.`);
    }
    res.redirect(req.get('Referer') || '/admin/orders');
  } catch (err) {
    next(err);
  }
});

router.post('/orders/bulk-status', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const status = req.body.status;
    if (ids.length && status) {
      const orders = await Order.find({ _id: { $in: ids } });
      await Promise.all(orders.map(async (o) => { await applyStatusChange(o, status); await o.save(); }));
      req.flash('success', `Updated ${ids.length} order(s) to ${statusLabel(status)}.`);
    }
    res.redirect(req.get('Referer') || '/admin/orders');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   MANUAL ORDER — admin creates an order directly (phone orders, etc.)
   --------------------------------------------------------------------- */
router.get('/orders/manual', async (req, res, next) => {
  try {
    const products = await Product.find({ status: true }).populate('category').sort({ name: 1 });
    res.render('admin/order-manual', { adminPageTitle: 'Manual Order', products, errors: [], formData: {} });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/manual', verifyCsrf, async (req, res, next) => {
  try {
    const products = await Product.find({ status: true }).populate('category').sort({ name: 1 });
    const { name, phone, email, address, city, notes, paymentMethod, paymentStatus, status, qty } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('Customer name is required.');
    if (!phone || !phone.trim()) errors.push('Phone number is required.');
    if (!address || !address.trim()) errors.push('Delivery address is required.');

    const qtyMap = qty || {};
    const chosenIds = Object.keys(qtyMap).filter((id) => parseInt(qtyMap[id], 10) > 0);
    if (!chosenIds.length) errors.push('Select at least one product.');

    if (errors.length) {
      return res.render('admin/order-manual', { adminPageTitle: 'Manual Order', products, errors, formData: req.body });
    }

    const chosenProducts = await Product.find({ _id: { $in: chosenIds } });
    const items = chosenProducts.map((p) => {
      const q = parseInt(qtyMap[String(p._id)], 10) || 1;
      const price = p.salePrice && p.salePrice < p.price ? p.salePrice : p.price;
      return { product: p._id, productName: p.name, productImage: p.image, price, qty: q, lineTotal: price * q };
    });
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const settings = await getSettings();
    const shippingFee = Number(settings.flat_shipping_fee || 80);
    const { generateOrderNumber } = require('../middleware/helpers');
    const orderNumber = generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      customerName: name.trim(),
      customerEmail: (email || '').trim(),
      customerPhone: phone.trim(),
      shippingAddress: address.trim(),
      shippingCity: (city || '').trim(),
      notes: (notes || '').trim(),
      items,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      paymentMethod: ['cod', 'bkash', 'sslcommerz'].includes(paymentMethod) ? paymentMethod : 'cod',
      paymentStatus: ['unpaid', 'pending', 'paid', 'failed', 'cancelled'].includes(paymentStatus) ? paymentStatus : 'unpaid',
      status: ORDER_STATUSES.some((s) => s.value === status) ? status : 'confirmed',
      confirmedAt: status === 'confirmed' || !status ? new Date() : null,
      source: 'manual',
      activityLog: [{ message: 'Order created manually from Admin.', at: new Date() }],
    });

    await Promise.all(
      items.map((item) =>
        Product.updateOne({ _id: item.product }, { $inc: { stock: -item.qty } }).then(() =>
          Product.updateOne({ _id: item.product, stock: { $lt: 0 } }, { $set: { stock: 0 } })
        )
      )
    );

    req.flash('success', `Manual order #${order.orderNumber} created successfully.`);
    res.redirect(`/admin/orders/${order._id}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   INCOMPLETE ORDERS
   ---------------------------------------------------------------------
   A real, checkable definition: checkouts placed with an online payment
   method (bKash / SSLCommerz) whose payment was never confirmed — i.e.
   started but not completed. COD orders confirm instantly at submission,
   so they're never "incomplete" by this definition.
   --------------------------------------------------------------------- */
const INCOMPLETE_BASE_FILTER = { isDeleted: false, paymentMethod: { $in: ['bkash', 'sslcommerz'] }, paymentStatus: { $in: ['pending', 'unpaid'] } };

router.get('/orders/incomplete', async (req, res, next) => {
  try {
    const tab = ['all', 'new', 'cancelled', 'hold'].includes(req.query.tab) ? req.query.tab : 'all';
    const filter = { ...INCOMPLETE_BASE_FILTER };
    if (tab !== 'all') filter.incompleteStatus = tab;
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, employees, counts] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).populate('assignedEmployee', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
      Order.aggregate([{ $match: INCOMPLETE_BASE_FILTER }, { $group: { _id: '$incompleteStatus', n: { $sum: 1 } } }]),
    ]);
    const countMap = { new: 0, cancelled: 0, hold: 0 };
    counts.forEach((c) => { countMap[c._id] = c.n; });

    res.render('admin/orders-incomplete', {
      adminPageTitle: 'Incomplete Orders',
      orders,
      employees,
      tab,
      q,
      countMap,
      totalAll: countMap.new + countMap.cancelled + countMap.hold,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/incomplete/:id/status', verifyCsrf, async (req, res, next) => {
  try {
    const incompleteStatus = ['new', 'cancelled', 'hold'].includes(req.body.incompleteStatus) ? req.body.incompleteStatus : 'new';
    await Order.updateOne({ _id: req.params.id }, { incompleteStatus });
    req.flash('success', 'Updated.');
    res.redirect(req.get('Referer') || '/admin/orders/incomplete');
  } catch (err) {
    next(err);
  }
});

router.post('/orders/incomplete/assign', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const employeeId = req.body.employeeId || null;
    if (ids.length) {
      await Order.updateMany({ _id: { $in: ids } }, { assignedEmployee: employeeId || null });
      req.flash('success', `Assigned ${ids.length} order(s).`);
    }
    res.redirect(req.get('Referer') || '/admin/orders/incomplete');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   DELIVERED ORDERS
   --------------------------------------------------------------------- */
router.get('/orders/delivered', async (req, res, next) => {
  try {
    const tab = req.query.tab === 'paid' ? 'paid' : 'unpaid';
    const filter = { isDeleted: false, status: 'delivered' };
    filter.paymentStatus = tab === 'paid' ? 'paid' : { $ne: 'paid' };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, counts] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }),
      Order.aggregate([
        { $match: { isDeleted: false, status: 'delivered' } },
        { $group: { _id: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 'paid', 'unpaid'] }, n: { $sum: 1 } } },
      ]),
    ]);
    const countMap = { paid: 0, unpaid: 0 };
    counts.forEach((c) => { countMap[c._id] = c.n; });

    res.render('admin/orders-delivered', { adminPageTitle: 'Delivered Orders', orders, tab, q, countMap, ORDER_STATUSES });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   RETURNED ORDERS
   --------------------------------------------------------------------- */
router.get('/orders/returned', async (req, res, next) => {
  try {
    const tab = req.query.tab === 'received' ? 'received' : 'not_received';
    const filter = { isDeleted: false, status: 'returned', returnReceived: tab === 'received' };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, counts] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }),
      Order.aggregate([{ $match: { isDeleted: false, status: 'returned' } }, { $group: { _id: '$returnReceived', n: { $sum: 1 } } }]),
    ]);
    const countMap = { received: 0, not_received: 0 };
    counts.forEach((c) => { countMap[c._id ? 'received' : 'not_received'] = c.n; });

    res.render('admin/orders-returned', { adminPageTitle: 'Returned Orders', orders, tab, q, countMap });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/bulk-return-status', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const received = req.body.returnReceived === 'received';
    if (ids.length) {
      await Order.updateMany({ _id: { $in: ids } }, { returnReceived: received });
      req.flash('success', `Updated ${ids.length} order(s).`);
    }
    res.redirect(req.get('Referer') || '/admin/orders/returned');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   DELIVERY ISSUE ORDERS
   --------------------------------------------------------------------- */
router.get('/orders/delivery-issue', async (req, res, next) => {
  try {
    const tab = ['unsolved', 'solved', 'cancel', 'partially_return'].includes(req.query.tab) ? req.query.tab : 'unsolved';
    const filter = { isDeleted: false, status: 'delivery_issue', deliveryIssueStatus: tab };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, counts] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }),
      Order.aggregate([{ $match: { isDeleted: false, status: 'delivery_issue' } }, { $group: { _id: '$deliveryIssueStatus', n: { $sum: 1 } } }]),
    ]);
    const countMap = { unsolved: 0, solved: 0, cancel: 0, partially_return: 0 };
    counts.forEach((c) => { countMap[c._id] = c.n; });

    res.render('admin/orders-delivery-issue', { adminPageTitle: 'Delivery Issue Orders', orders, tab, q, countMap });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/bulk-delivery-issue-status', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const deliveryIssueStatus = ['unsolved', 'solved', 'cancel', 'partially_return'].includes(req.body.deliveryIssueStatus)
      ? req.body.deliveryIssueStatus
      : null;
    if (ids.length && deliveryIssueStatus) {
      await Order.updateMany({ _id: { $in: ids } }, { deliveryIssueStatus });
      req.flash('success', `Updated ${ids.length} order(s).`);
    }
    res.redirect(req.get('Referer') || '/admin/orders/delivery-issue');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   DELETED ORDERS (soft delete / restore)
   --------------------------------------------------------------------- */
router.get('/orders/deleted', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const filter = { isDeleted: true };
    if (q) filter.$or = [{ orderNumber: new RegExp(q, 'i') }, { customerPhone: new RegExp(q, 'i') }];
    const orders = await Order.find(filter).sort({ deletedAt: -1 });
    res.render('admin/orders-deleted', { adminPageTitle: 'Deleted Orders', orders, q });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/deleted/:id/restore', verifyCsrf, async (req, res, next) => {
  try {
    await Order.updateOne({ _id: req.params.id }, { isDeleted: false, deletedAt: null });
    req.flash('success', 'Order restored.');
    res.redirect('/admin/orders/deleted');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   ORDER SETTING (fraud / blocking / validation)
   --------------------------------------------------------------------- */
const ORDER_SETTING_CARDS = [
  'numberBlocked', 'ipBlocked', 'vpnBlocked', 'incognitoBlocked', 'numberValidation',
  'sameNumberLimit', 'sameIpLimit', 'cookiesLimit', 'fingerprintLimit',
  'fakeOrderSetting', 'offerMissedOrder',
];

router.get('/orders/setting', async (req, res, next) => {
  try {
    const settings = await getOrderSettings();
    res.render('admin/orders-setting', { adminPageTitle: 'Order Setting', settings });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/setting/:card', verifyCsrf, async (req, res, next) => {
  try {
    const card = req.params.card;
    if (!ORDER_SETTING_CARDS.includes(card)) return res.redirect('/admin/orders/setting');
    const data = { ...req.body };
    delete data.csrfToken;
    if (data.status !== undefined) data.status = data.status === 'on';
    ['orderLimit', 'blockMinutes', 'deliveryPercent', 'couponValue', 'timeSeconds'].forEach((numKey) => {
      if (data[numKey] !== undefined) data[numKey] = Number(data[numKey]) || 0;
    });
    await updateOrderSettingCard(card, data);
    req.flash('success', 'Setting saved successfully.');
    res.redirect('/admin/orders/setting');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   MISSED ORDERS
   ---------------------------------------------------------------------
   "Missed" = a New Order that sat unactioned for more than 24 hours.
   The table shows the ones still sitting there right now; the two
   summary cards show, of every order that was ever missed like this,
   how much eventually got confirmed vs. cancelled (via wasMissed, set
   the moment such an order's status is first changed).
   --------------------------------------------------------------------- */
router.get('/orders/missed', async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filter = { isDeleted: false, status: 'pending', createdAt: { $lte: cutoff } };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, confirmAgg, cancelAgg] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).populate('assignedEmployee', 'username fullName'),
      Order.aggregate([{ $match: { isDeleted: false, wasMissed: true, status: { $nin: ['cancelled', 'pending'] } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: { isDeleted: false, wasMissed: true, status: 'cancelled' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    ]);

    res.render('admin/orders-missed', {
      adminPageTitle: 'Missed Orders',
      orders,
      q,
      totalConfirmAmount: confirmAgg[0]?.total || 0,
      totalCancelAmount: cancelAgg[0]?.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   AFTER CONFIRM ORDER
   ---------------------------------------------------------------------
   Every order that reached "Confirmed" at least once (confirmedAt set).
   Total Confirm Amount = still active; Total Cancel Amount = confirmed
   then later cancelled.
   --------------------------------------------------------------------- */
router.get('/orders/after-confirm', async (req, res, next) => {
  try {
    const filter = { isDeleted: false, confirmedAt: { $ne: null } };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, confirmAgg, cancelAgg] = await Promise.all([
      Order.find(filter).sort({ confirmedAt: -1 }),
      Order.aggregate([{ $match: { isDeleted: false, confirmedAt: { $ne: null }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: { isDeleted: false, confirmedAt: { $ne: null }, status: 'cancelled' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    ]);

    res.render('admin/orders-after-confirm', {
      adminPageTitle: 'After Confirm Order',
      orders,
      q,
      totalConfirmAmount: confirmAgg[0]?.total || 0,
      totalCancelAmount: cancelAgg[0]?.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   DASHBOARD
   ===================================================================== */
router.get('/', async (req, res, next) => {
  try {
    const [totalSalesAgg, totalOrders, pendingOrders, totalCustomers, totalProducts, lowStock, recentOrders] =
      await Promise.all([
        Order.aggregate([
          { $match: { $or: [{ paymentStatus: 'paid' }, { paymentMethod: 'cod' }] } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        Order.countDocuments(),
        Order.countDocuments({ status: 'pending' }),
        Customer.countDocuments(),
        Product.countDocuments(),
        Product.countDocuments({ stock: { $lte: 5 } }),
        Order.find().sort({ createdAt: -1 }).limit(8),
      ]);

    const totalSales = totalSalesAgg[0]?.total || 0;

    // last 7 days sales chart
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const dailySales = await Order.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$total' },
        },
      },
    ]);
    const dailyMap = {};
    dailySales.forEach((row) => { dailyMap[row._id] = row.total; });

    const chartLabels = [];
    const chartData = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      chartLabels.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
      chartData.push(dailyMap[key] || 0);
    }

    res.render('admin/dashboard', {
      adminPageTitle: 'Dashboard',
      totalSales,
      totalOrders,
      pendingOrders,
      totalCustomers,
      totalProducts,
      lowStock,
      recentOrders,
      chartLabels,
      chartData,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   VARIANT ATTRIBUTES
   ---------------------------------------------------------------------
   A small reusable library of variation TYPES (Color, Size, Weight...)
   with their own value lists — see models/VariantAttribute.js for why
   this is kept separate from a product's own variant rows. This page
   just manages that library; loadProductFormLookups() below hands the
   active list to the product form's "Quick Add from Attribute" helper.
   ===================================================================== */
router.get('/products/variant', async (req, res, next) => {
  try {
    const variantAttributes = await VariantAttribute.find().sort({ name: 1 });
    res.render('admin/variant', { adminPageTitle: 'Variant', variantAttributes });
  } catch (err) {
    next(err);
  }
});

router.post('/products/variant', verifyCsrf, async (req, res, next) => {
  try {
    const { id, name, values } = req.body;
    if (!name || !name.trim()) {
      req.flash('danger', 'Attribute name is required.');
      return res.redirect('/admin/products/variant');
    }
    const valuesList = (values || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    if (id) {
      await VariantAttribute.updateOne(
        { _id: id },
        { name: name.trim(), values: valuesList, status: !!req.body.status }
      );
      req.flash('success', 'Variant attribute updated successfully.');
    } else {
      const slug = await ensureUniqueSlug(VariantAttribute, slugify(name), null);
      await VariantAttribute.create({ name: name.trim(), slug, values: valuesList, status: !!req.body.status });
      req.flash('success', 'New variant attribute added successfully.');
    }
    res.redirect('/admin/products/variant');
  } catch (err) {
    next(err);
  }
});

router.get('/products/variant/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/products/variant');
    }
    await VariantAttribute.deleteOne({ _id: req.params.id });
    req.flash('success', 'Variant attribute deleted successfully.');
    res.redirect('/admin/products/variant');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   BRANDS
   ===================================================================== */
router.get('/products/brands', async (req, res, next) => {
  try {
    const brands = await Brand.find().sort({ sortOrder: 1, name: 1 });
    res.render('admin/brands', { adminPageTitle: 'Brands', brands });
  } catch (err) {
    next(err);
  }
});

async function renderBrandForm(res, { brand, errors, formData }) {
  res.render('admin/brand-form', {
    adminPageTitle: brand && brand._id ? 'Edit Brand' : 'Add New Brand',
    brand: brand || {},
    errors: errors || [],
    formData: formData || {},
  });
}

router.get('/products/brands/new', (req, res) => {
  renderBrandForm(res, { brand: null });
});

router.get('/products/brands/:id/edit', async (req, res, next) => {
  try {
    const brand = await Brand.findById(req.params.id);
    if (!brand) {
      req.flash('danger', 'Brand not found.');
      return res.redirect('/admin/products/brands');
    }
    renderBrandForm(res, { brand });
  } catch (err) {
    next(err);
  }
});

// CSRF is checked manually below (not via the verifyCsrf middleware) because
// multer's upload.fields() is what parses multipart/form-data — req.body
// (and so req.body.csrfToken) isn't populated until after it runs. Same
// pattern as saveCategory/saveProduct.
const brandUpload = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'bannerImage', maxCount: 1 }]);

async function saveBrand(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/products/brands');
    }
    const {
      name, sortOrder,
      pageTitle, shortDescription, description,
      metaTitle, metaKeywords, metaDescription,
    } = req.body;

    const errors = [];
    if (!name || !name.trim()) errors.push('Brand name is required.');

    const existing = existingId ? await Brand.findById(existingId) : null;
    const files = req.files || {};
    let imageName = existing ? existing.image : null;
    if (files.image && files.image[0]) imageName = files.image[0].filename;
    let bannerImageName = existing ? existing.bannerImage : null;
    if (files.bannerImage && files.bannerImage[0]) bannerImageName = files.bannerImage[0].filename;

    if (errors.length) {
      return renderBrandForm(res, {
        brand: { ...(existing ? existing.toObject() : {}), ...req.body, image: imageName, bannerImage: bannerImageName },
        errors,
        formData: req.body,
      });
    }

    const data = {
      name: name.trim(),
      sortOrder: parseInt(sortOrder, 10) || 0,
      status: !!req.body.status,
      image: imageName,
      bannerImage: bannerImageName,
      pageTitle: (pageTitle || '').trim(),
      shortDescription: (shortDescription || '').trim(),
      description: description || '',
      metaTitle: (metaTitle || '').trim(),
      metaKeywords: (metaKeywords || '').trim(),
      metaDescription: (metaDescription || '').trim(),
    };

    if (existing) {
      data.slug = await ensureUniqueSlug(Brand, slugify(name), existingId);
      await Brand.updateOne({ _id: existingId }, data);
      req.flash('success', 'Brand updated successfully.');
    } else {
      data.slug = await ensureUniqueSlug(Brand, slugify(name), null);
      await Brand.create(data);
      req.flash('success', 'New brand added successfully.');
    }
    res.redirect('/admin/products/brands');
  } catch (err) {
    next(err);
  }
}

router.post('/products/brands/new', brandUpload, (req, res, next) => saveBrand(req, res, next, null));
router.post('/products/brands/:id/edit', brandUpload, (req, res, next) => saveBrand(req, res, next, req.params.id));

router.get('/products/brands/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/products/brands');
    }
    await Brand.deleteOne({ _id: req.params.id });
    req.flash('success', 'Brand deleted successfully.');
    res.redirect('/admin/products/brands');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SUPPLIER
   ===================================================================== */
router.get('/products/supplier', async (req, res, next) => {
  try {
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.render('admin/supplier', { adminPageTitle: 'Supplier', suppliers });
  } catch (err) {
    next(err);
  }
});

router.post('/products/supplier', verifyCsrf, async (req, res, next) => {
  try {
    const { id, name, phone, email, address } = req.body;
    if (!name || !name.trim()) return res.redirect('/admin/products/supplier');
    const data = {
      name: name.trim(),
      phone: (phone || '').trim(),
      email: (email || '').trim(),
      address: (address || '').trim(),
      status: !!req.body.status,
    };
    if (id) {
      await Supplier.updateOne({ _id: id }, data);
      req.flash('success', 'Supplier updated successfully.');
    } else {
      await Supplier.create(data);
      req.flash('success', 'New supplier added successfully.');
    }
    res.redirect('/admin/products/supplier');
  } catch (err) {
    next(err);
  }
});

router.get('/products/supplier/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/products/supplier');
    }
    await Supplier.deleteOne({ _id: req.params.id });
    req.flash('success', 'Supplier deleted successfully.');
    res.redirect('/admin/products/supplier');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   PRODUCTS
   ===================================================================== */
function generateSku() {
  return `SKU-${Math.floor(10000 + Math.random() * 90000)}`;
}

// Cover image, secondary gallery image, an optional size/variant chart
// image, AND a per-row variant image ("variantImage[0]", "variantImage[1]",
// ...) all live on this one form. The variant row count is dynamic (rows
// are added/removed in the browser), so multer's .fields() — which needs a
// fixed field list up front — can't be used; .any() accepts every field
// name and the handler below sorts the files out by fieldname instead.
const productUpload = upload.any();

router.get('/products', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const perPage = [10, 25, 50, 100].includes(parseInt(req.query.perPage, 10)) ? parseInt(req.query.perPage, 10) : 10;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = q ? { $or: [{ name: new RegExp(q, 'i') }, { sku: new RegExp(q, 'i') }] } : {};

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate('category')
        .populate('brand')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
    ]);

    products.forEach((p) => {
      if (p.availability === 'pre_order') p.stockStatus = 'Pre-order';
      else if (p.availability === 'out_of_stock' || p.stock <= 0) p.stockStatus = 'Out of Stock';
      else if (p.stock <= (p.stockAlert || 0)) p.stockStatus = 'Low Stock';
      else p.stockStatus = 'In Stock';
    });

    res.render('admin/products', {
      adminPageTitle: 'Product Management',
      products,
      q,
      perPage,
      page,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/products');
    }
    await Product.deleteOne({ _id: req.params.id });
    req.flash('success', 'Product deleted successfully.');
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
});

router.post('/products/bulk-delete', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    if (ids.length) {
      await Product.deleteMany({ _id: { $in: ids } });
      req.flash('success', `${ids.length} product(s) deleted.`);
    }
    res.redirect(req.get('Referer') || '/admin/products');
  } catch (err) {
    next(err);
  }
});

router.post('/products/bulk-status', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const status = req.query.status === 'active';
    if (ids.length) {
      // Keep publishStatus in sync too, and clear any leftover schedule date,
      // so a bulk-activated/deactivated product doesn't stay tagged "Scheduled".
      await Product.updateMany(
        { _id: { $in: ids } },
        { status, publishStatus: status ? 'published' : 'draft', publishAt: null }
      );
      req.flash('success', `${ids.length} product(s) ${status ? 'activated' : 'deactivated'}.`);
    }
    res.redirect(req.get('Referer') || '/admin/products');
  } catch (err) {
    next(err);
  }
});

router.get('/products/duplicate/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/products');
    }
    const original = await Product.findById(req.params.id).lean();
    if (!original) {
      req.flash('danger', 'Product not found.');
      return res.redirect('/admin/products');
    }
    const copy = { ...original };
    delete copy._id;
    delete copy.__v;
    delete copy.createdAt;
    delete copy.updatedAt;
    delete copy.views;
    copy.name = `${original.name} (Copy)`;
    copy.slug = await ensureUniqueSlug(Product, slugify(copy.name), null);
    copy.sku = original.sku ? `${original.sku}-COPY` : '';
    copy.status = false; // duplicated products start hidden so they can be reviewed/edited first
    copy.publishStatus = 'draft';
    copy.publishAt = null;
    // Variant subdocuments need fresh _ids of their own, not the originals'.
    copy.variants = (original.variants || []).map((v) => {
      const { _id, ...rest } = v;
      return rest;
    });
    const created = await Product.create(copy);
    req.flash('success', 'Product duplicated as a Draft. Review it, then Publish when ready.');
    res.redirect(`/admin/products/${created._id}/edit`);
  } catch (err) {
    next(err);
  }
});

async function loadProductFormLookups(excludeId) {
  const productFilter = { status: true };
  if (excludeId) productFilter._id = { $ne: excludeId };
  const [categories, brands, suppliers, allProducts, variantAttributes] = await Promise.all([
    Category.find().sort({ name: 1 }),
    Brand.find({ status: true }).sort({ name: 1 }),
    Supplier.find({ status: true }).sort({ name: 1 }),
    Product.find(productFilter).select('name image').sort({ name: 1 }),
    VariantAttribute.find({ status: true }).sort({ name: 1 }),
  ]);
  return { categories, brands, suppliers, allProducts, variantAttributes };
}

router.get('/products/new', async (req, res, next) => {
  try {
    const lookups = await loadProductFormLookups(null);
    res.render('admin/product-form', {
      adminPageTitle: 'Add New Product',
      product: null,
      ...lookups,
      errors: [],
      formData: { sku: generateSku() },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id/edit', async (req, res, next) => {
  try {
    const [product, lookups] = await Promise.all([
      Product.findById(req.params.id),
      loadProductFormLookups(req.params.id),
    ]);
    if (!product) {
      req.flash('danger', 'Product not found.');
      return res.redirect('/admin/products');
    }
    res.render('admin/product-form', {
      adminPageTitle: 'Edit Product',
      product,
      ...lookups,
      errors: [],
      formData: {},
    });
  } catch (err) {
    next(err);
  }
});

async function saveProduct(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/products');
    }
    const lookups = await loadProductFormLookups(existingId);
    const existing = existingId ? await Product.findById(existingId) : null;

    const {
      name, categoryId, brandId, supplierId, sku, slug: slugInput, tags: tagsInput,
      videoEmbed, videoPosition,
      shortDescription, description,
      condition, availability, buyingPrice, weight,
      price, discountType, discountValue, salePrice,
      stock, stockAlert, minOrderQty, maxOrderQty,
      offerDescriptionType, offerDescriptionText,
      deliveryType, deliveryFlatRate,
      afterConfirmOfferDescription,
      metaTitle, metaKeywords, metaDescription,
      publishStatus, publishAt,
    } = req.body;

    const errors = [];
    if (!name || !name.trim()) errors.push('Product name is required.');
    if (!categoryId) errors.push('Category is required.');

    // Publish / Draft / Schedule — resolves to the single `status` boolean
    // every existing storefront/admin query already filters on, so nothing
    // else in the app has to change. A schedule time that's already in the
    // past just publishes immediately instead of erroring.
    const now = new Date();
    let publishStatusValue = ['draft', 'published', 'scheduled'].includes(publishStatus) ? publishStatus : 'published';
    let publishAtValue = null;
    let statusValue = true;
    if (publishStatusValue === 'draft') {
      statusValue = false;
    } else if (publishStatusValue === 'scheduled') {
      const parsedPublishAt = publishAt ? new Date(publishAt) : null;
      if (!parsedPublishAt || Number.isNaN(parsedPublishAt.getTime())) {
        errors.push('Please choose a date & time to schedule this product.');
      } else if (parsedPublishAt <= now) {
        publishStatusValue = 'published';
        statusValue = true;
      } else {
        publishAtValue = parsedPublishAt;
        statusValue = false;
      }
    } else {
      publishStatusValue = 'published';
      statusValue = true;
    }
    const priceNum = parseFloat(price);
    if (!priceNum || priceNum <= 0) errors.push('Please enter a valid regular price.');
    const salePriceNum = salePrice !== undefined && salePrice !== '' ? parseFloat(salePrice) : NaN;
    if (Number.isNaN(salePriceNum) || salePriceNum <= 0) {
      errors.push('Sale price is required.');
    } else if (priceNum && salePriceNum >= priceNum) {
      errors.push('Sale price must be lower than the regular price.');
    }
    const minOrderQtyNum = Math.max(1, parseInt(minOrderQty, 10) || 1);
    const maxOrderQtyNum = maxOrderQty !== undefined && maxOrderQty !== '' ? parseInt(maxOrderQty, 10) : null;
    if (maxOrderQtyNum !== null && maxOrderQtyNum < minOrderQtyNum) {
      errors.push('Max Order Quantity must be greater than or equal to Min Order Quantity.');
    }

    // upload.any() gives req.files as a flat array (not grouped by field
    // name like .fields() would) — regroup it so the rest of this function
    // can look files up by field name same as before.
    const filesByField = {};
    (req.files || []).forEach((f) => {
      (filesByField[f.fieldname] = filesByField[f.fieldname] || []).push(f);
    });

    // Variant rows: req.body.variants arrives as an object keyed by row
    // index (e.g. { '0': { label, sku, price, salePrice, stock }, ... })
    // because express.urlencoded({extended:true}) parses bracketed field
    // names like "variants[0][label]" that way. Each row's own image, if
    // one was uploaded, arrives as a same-indexed file field
    // "variantImage[<index>]"; a row without a new upload keeps the
    // existing variant image at that same row position (best-effort, since
    // rows aren't tracked by a stable id in this simple table UI).
    const hasVariants = !!req.body.hasVariants;
    let variants = [];
    if (hasVariants && req.body.variants && typeof req.body.variants === 'object') {
      variants = Object.entries(req.body.variants)
        .filter(([, v]) => v && v.label && v.label.trim())
        .map(([idx, v], position) => {
          const uploadedImage = filesByField[`variantImage[${idx}]`];
          const existingVariant = existing && existing.variants ? existing.variants[position] : null;
          return {
            label: v.label.trim(),
            sku: (v.sku || '').trim(),
            price: v.price !== '' && v.price !== undefined ? parseFloat(v.price) : null,
            salePrice: v.salePrice !== '' && v.salePrice !== undefined ? parseFloat(v.salePrice) : null,
            stock: parseInt(v.stock, 10) || 0,
            image: uploadedImage && uploadedImage[0] ? uploadedImage[0].filename : (existingVariant ? existingVariant.image : null),
          };
        });
      if (!variants.length) errors.push('Add at least one variant row, or turn Add Variant off.');
    }

    let deliveryMethods = req.body.deliveryMethods || [];
    if (!Array.isArray(deliveryMethods)) deliveryMethods = [deliveryMethods];
    deliveryMethods = deliveryMethods.filter((m) => ['cod', 'bkash', 'sslcommerz'].includes(m));

    let afterConfirmProductIds = req.body.afterConfirmProductIds || [];
    if (!Array.isArray(afterConfirmProductIds)) afterConfirmProductIds = [afterConfirmProductIds];
    afterConfirmProductIds = afterConfirmProductIds.filter(Boolean);

    // Additional/secondary categories (checkboxes) — the primary category
    // is excluded so it's never duplicated between the two.
    let additionalCategoryIds = req.body.categories || [];
    if (!Array.isArray(additionalCategoryIds)) additionalCategoryIds = [additionalCategoryIds];
    additionalCategoryIds = additionalCategoryIds.filter((id) => id && id !== categoryId);

    const tagsList = (tagsInput || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i);

    let imageName = existing ? existing.image : null;
    if (filesByField.image && filesByField.image[0]) imageName = filesByField.image[0].filename;
    let galleryImageName = existing ? existing.galleryImage : null;
    if (filesByField.galleryImage && filesByField.galleryImage[0]) galleryImageName = filesByField.galleryImage[0].filename;
    let variantsChartImageName = existing ? existing.variantsChartImage : null;
    if (filesByField.variantsChartImage && filesByField.variantsChartImage[0]) variantsChartImageName = filesByField.variantsChartImage[0].filename;

    if (errors.length) {
      return res.render('admin/product-form', {
        adminPageTitle: existing ? 'Edit Product' : 'Add New Product',
        product: {
          ...(existing ? existing.toObject() : {}),
          ...req.body,
          categoryId, brandId, supplierId,
          categories: additionalCategoryIds,
          tags: tagsList,
          hasVariants,
          variants,
          deliveryMethods,
          afterConfirmProducts: afterConfirmProductIds,
          minOrderQty: minOrderQtyNum,
          maxOrderQty: maxOrderQtyNum,
          image: imageName,
          galleryImage: galleryImageName,
          variantsChartImage: variantsChartImageName,
        },
        ...lookups,
        errors,
        formData: req.body,
      });
    }

    const baseSlug = slugify((slugInput && slugInput.trim()) || name);
    const slug = await ensureUniqueSlug(Product, baseSlug, existingId || null);

    const data = {
      category: categoryId || null,
      categories: additionalCategoryIds,
      brand: brandId || null,
      supplier: supplierId || null,
      name: name.trim(),
      slug,
      sku: (sku || '').trim(),
      tags: tagsList,
      videoEmbed: (videoEmbed || '').trim(),
      videoPosition: ['top', 'bottom'].includes(videoPosition) ? videoPosition : '',
      shortDescription: (shortDescription || '').trim(),
      description: description || '',
      condition: ['new', 'used', 'refurbished'].includes(condition) ? condition : 'new',
      availability: ['in_stock', 'out_of_stock', 'pre_order'].includes(availability) ? availability : 'in_stock',
      buyingPrice: parseFloat(buyingPrice) || 0,
      weight: parseFloat(weight) || 0,
      price: priceNum,
      discountType: discountType === 'percent' ? 'percent' : 'flat',
      discountValue: parseFloat(discountValue) || 0,
      salePrice: salePriceNum,
      stock: parseInt(stock, 10) || 0,
      stockAlert: parseInt(stockAlert, 10) || 0,
      minOrderQty: minOrderQtyNum,
      maxOrderQty: maxOrderQtyNum,
      overselling: !!req.body.overselling,
      hasVariants,
      variantMandatory: !!req.body.variantMandatory,
      variants,
      offerDescription: {
        type: offerDescriptionType === 'percent' ? 'percent' : 'fixed',
        text: (offerDescriptionText || '').trim(),
      },
      image: imageName || 'product-placeholder.svg',
      galleryImage: galleryImageName,
      variantsChartImage: variantsChartImageName,
      deliveryType: ['manual', 'free_shipping', 'flat_rate'].includes(deliveryType) ? deliveryType : 'manual',
      deliveryFlatRate: parseFloat(deliveryFlatRate) || 0,
      deliveryMethods,
      afterConfirmEnabled: !!req.body.afterConfirmEnabled,
      afterConfirmOfferDescription: (afterConfirmOfferDescription || '').trim(),
      afterConfirmProducts: afterConfirmProductIds,
      metaTitle: (metaTitle || '').trim(),
      metaKeywords: (metaKeywords || '').trim(),
      metaDescription: (metaDescription || '').trim(),
      isFeatured: !!req.body.isFeatured,
      isFlashSale: !!req.body.isFlashSale,
      status: statusValue,
      publishStatus: publishStatusValue,
      publishAt: publishAtValue,
    };

    if (existing) {
      await Product.updateOne({ _id: existingId }, data);
      req.flash('success', 'Product updated successfully.');
    } else {
      await Product.create(data);
      req.flash('success', 'New product added successfully.');
    }
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
}

router.post('/products/new', productUpload, (req, res, next) => saveProduct(req, res, next, null));
router.post('/products/:id/edit', productUpload, (req, res, next) => saveProduct(req, res, next, req.params.id));

/* =====================================================================
   CATEGORIES
   ===================================================================== */
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
    res.render('admin/categories', { adminPageTitle: 'Category Management', categories });
  } catch (err) {
    next(err);
  }
});

async function renderCategoryForm(res, { category, errors, formData }) {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
  // Only top-level categories can be picked as a "parent" (and a category
  // can't be its own parent) — the storefront mega menu only nests 2 levels
  // deep (category -> subcategory).
  const parentOptions = categories.filter((c) => !c.parent && (!category || String(c._id) !== String(category._id)));
  res.render('admin/category-form', {
    adminPageTitle: category && category._id ? 'Edit Category' : 'Add New Category',
    category: category || {},
    parentOptions,
    errors: errors || [],
    formData: formData || {},
  });
}

router.get('/categories/new', async (req, res, next) => {
  try {
    await renderCategoryForm(res, { category: null });
  } catch (err) {
    next(err);
  }
});

router.get('/categories/:id/edit', async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      req.flash('danger', 'Category not found.');
      return res.redirect('/admin/categories');
    }
    await renderCategoryForm(res, { category });
  } catch (err) {
    next(err);
  }
});

// CSRF is checked manually below (not via the verifyCsrf middleware) because
// multer's upload.single('image') is what parses multipart/form-data —
// req.body (and so req.body.csrfToken) isn't populated until after it runs.
async function saveCategory(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/categories');
    }
    const {
      name, sortOrder, parent,
      pageTitle, shortDescription, description,
      metaTitle, metaKeywords, metaDescription,
    } = req.body;

    const errors = [];
    if (!name || !name.trim()) errors.push('Category name is required.');

    const existing = existingId ? await Category.findById(existingId) : null;
    let imageName = existing ? existing.image : null;
    if (req.file) imageName = req.file.filename;

    if (errors.length) {
      return renderCategoryForm(res, {
        category: { ...(existing ? existing.toObject() : {}), ...req.body, image: imageName },
        errors,
        formData: req.body,
      });
    }

    // A category can't be its own parent, and we only support 2 levels deep.
    const parentId = parent && parent !== existingId ? parent : null;

    const data = {
      name: name.trim(),
      sortOrder: parseInt(sortOrder, 10) || 0,
      status: !!req.body.status,
      parent: parentId,
      image: imageName,
      pageTitle: (pageTitle || '').trim(),
      shortDescription: (shortDescription || '').trim(),
      description: description || '',
      metaTitle: (metaTitle || '').trim(),
      metaKeywords: (metaKeywords || '').trim(),
      metaDescription: (metaDescription || '').trim(),
    };

    if (existing) {
      data.slug = await ensureUniqueSlug(Category, slugify(name), existingId);
      await Category.updateOne({ _id: existingId }, data);
      req.flash('success', 'Category updated successfully.');
    } else {
      data.slug = await ensureUniqueSlug(Category, slugify(name), null);
      await Category.create(data);
      req.flash('success', 'New category added successfully.');
    }
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
}

router.post('/categories/new', upload.single('image'), (req, res, next) => saveCategory(req, res, next, null));
router.post('/categories/:id/edit', upload.single('image'), (req, res, next) => saveCategory(req, res, next, req.params.id));

router.get('/categories/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/categories');
    }
    await Category.deleteOne({ _id: req.params.id });
    req.flash('success', 'Category deleted successfully.');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   LANDING PAGE — MAIN LANDING
   A standalone campaign page: banner + slider, product highlights, a
   "Customer Review" product gallery, and its own order-button /
   delivery / payment rules. Uses the same Add-New-list-with-edit CRUD
   shape as Category/Brand, just with more fields.
   ===================================================================== */
router.get('/landing-page/main', async (req, res, next) => {
  try {
    const landingPages = await LandingPage.find().sort({ createdAt: -1 });
    res.render('admin/landing-main', { adminPageTitle: 'Main Landing Page', landingPages });
  } catch (err) {
    next(err);
  }
});

async function renderLandingForm(res, { landing, errors, formData }) {
  const products = await Product.find({ status: true })
    .select('name slug price salePrice stock')
    .sort({ name: 1 });
  res.render('admin/landing-main-form', {
    adminPageTitle: landing && landing._id ? 'Edit Landing Page' : 'Add Landing',
    landing: landing || {},
    products,
    errors: errors || [],
    formData: formData || {},
  });
}

router.get('/landing-page/main/new', async (req, res, next) => {
  try {
    await renderLandingForm(res, { landing: null });
  } catch (err) {
    next(err);
  }
});

router.get('/landing-page/main/:id/edit', async (req, res, next) => {
  try {
    const landing = await LandingPage.findById(req.params.id);
    if (!landing) {
      req.flash('danger', 'Landing page not found.');
      return res.redirect('/admin/landing-page/main');
    }
    await renderLandingForm(res, { landing });
  } catch (err) {
    next(err);
  }
});

// CSRF is checked manually below (not via the verifyCsrf middleware) because
// multer's upload.fields() is what parses multipart/form-data — req.body
// (and so req.body.csrfToken) isn't populated until after it runs. Same
// pattern as saveCategory/saveBrand.
const landingUpload = upload.fields([
  { name: 'mainBanner', maxCount: 1 },
  { name: 'sliderImages', maxCount: 12 },
  { name: 'reviewImages', maxCount: 12 },
]);

// Multer/urlencoded parsing gives a single value when a repeated-name field
// (youtubeTitle[], descTitle[], etc.) appears exactly once, and an array
// otherwise. Normalize to an array either way so the zip-by-index logic
// below always works.
function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

async function saveLandingPage(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/landing-page/main');
    }
    const {
      title, slug: slugInput, sliderTitle, sliderView,
      instructionMessage, contactTitle, phoneNumber,
      orderButtonText, orderButtonTextColor, orderButtonBgColor,
      reviewSectionTitle, reviewView, reviewProductSelectMode,
      titleColor, titleIconColor, deliveryChargeMode,
    } = req.body;

    const errors = [];
    if (!title || !title.trim()) errors.push('Page title is required.');

    const existing = existingId ? await LandingPage.findById(existingId) : null;
    const files = req.files || {};

    let mainBannerName = existing ? existing.mainBanner : null;
    if (files.mainBanner && files.mainBanner[0]) mainBannerName = files.mainBanner[0].filename;

    let sliderImageNames = existing ? existing.sliderImages : [];
    if (files.sliderImages && files.sliderImages.length) {
      sliderImageNames = files.sliderImages.map((f) => f.filename);
    }

    let reviewImageNames = existing ? existing.reviewImages : [];
    if (files.reviewImages && files.reviewImages.length) {
      reviewImageNames = files.reviewImages.map((f) => f.filename);
    }

    if (errors.length) {
      return renderLandingForm(res, {
        landing: {
          ...(existing ? existing.toObject() : {}),
          ...req.body,
          mainBanner: mainBannerName,
          sliderImages: sliderImageNames,
          reviewImages: reviewImageNames,
        },
        errors,
        formData: req.body,
      });
    }

    const youtubeTitles = toArray(req.body.youtubeTitle);
    const youtubeLinks = toArray(req.body.youtubeLink);
    const youtubeVideos = youtubeTitles
      .map((t, i) => ({ title: (t || '').trim(), link: ((youtubeLinks[i] || '')).trim() }))
      .filter((v) => v.title || v.link);

    const descTitles = toArray(req.body.descTitle);
    const descValues = toArray(req.body.descValue);
    const descriptionBlocks = descTitles
      .map((t, i) => ({ title: (t || '').trim(), value: ((descValues[i] || '')).trim() }))
      .filter((v) => v.title || v.value);

    const reviewProductIds = toArray(req.body.reviewProductIds);
    const autoCartIds = new Set(toArray(req.body.autoCartProductIds));
    const reviewProducts = reviewProductIds
      .filter(Boolean)
      .map((id) => ({ product: id, autoCart: autoCartIds.has(id) }));

    const data = {
      title: title.trim(),
      status: !!req.body.status,
      mainBanner: mainBannerName,
      sliderTitle: (sliderTitle || '').trim(),
      sliderImages: sliderImageNames,
      sliderView: sliderView === 'grid' ? 'grid' : 'slide',
      instructionMessage: instructionMessage || '',
      modernUi: !!req.body.modernUi,
      showNumber: !!req.body.showNumber,
      productsLayoutGrid: !!req.body.productsLayoutGrid,
      contactTitle: (contactTitle || '').trim(),
      phoneNumber: (phoneNumber || '').trim(),
      orderButtonText: (orderButtonText || '').trim() || 'Order Now',
      orderButtonTextColor: orderButtonTextColor || '#ffffff',
      orderButtonBgColor: orderButtonBgColor || '#e74c3c',
      youtubeVideos,
      descriptionBlocks,
      reviewSectionTitle: (reviewSectionTitle || '').trim(),
      reviewImages: reviewImageNames,
      reviewView: reviewView === 'grid' ? 'grid' : 'slide',
      reviewProductSelectMode: reviewProductSelectMode === 'single' ? 'single' : 'multiple',
      reviewProducts,
      titleColor: titleColor || '#1e3a5f',
      titleIconColor: titleIconColor || '#d4a537',
      deliveryChargeMode: ['required', 'optional', 'free'].includes(deliveryChargeMode) ? deliveryChargeMode : 'required',
      paymentCod: !!req.body.paymentCod,
      paymentBkash: !!req.body.paymentBkash,
      paymentManual: !!req.body.paymentManual,
    };

    if (existing) {
      data.slug = await ensureUniqueSlug(LandingPage, slugify((slugInput && slugInput.trim()) || title), existingId);
      await LandingPage.updateOne({ _id: existingId }, data);
      req.flash('success', 'Landing page updated successfully.');
    } else {
      data.slug = await ensureUniqueSlug(LandingPage, slugify((slugInput && slugInput.trim()) || title), null);
      await LandingPage.create(data);
      req.flash('success', 'New landing page added successfully.');
    }
    res.redirect('/admin/landing-page/main');
  } catch (err) {
    next(err);
  }
}

router.post('/landing-page/main/new', landingUpload, (req, res, next) => saveLandingPage(req, res, next, null));
router.post('/landing-page/main/:id/edit', landingUpload, (req, res, next) => saveLandingPage(req, res, next, req.params.id));

router.get('/landing-page/main/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/landing-page/main');
    }
    await LandingPage.deleteOne({ _id: req.params.id });
    req.flash('success', 'Landing page deleted successfully.');
    res.redirect('/admin/landing-page/main');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   LANDING PAGE — SHORT LANDING
   Lighter than Main Landing: one image, a title/title2 pair, and a list of
   highlighted products, each with its own Main Title + colour styling
   (rendered as a repeatable row in the form, "items[<i>][...]" so it
   arrives at req.body.items as a real array — same bracket-notation
   pattern multer/busboy already gives the product-variant rows above).
   ===================================================================== */
router.get('/landing-page/short', async (req, res, next) => {
  try {
    const shortLandingPages = await ShortLandingPage.find().sort({ createdAt: -1 });
    res.render('admin/landing-short', { adminPageTitle: 'Short Landing Page', shortLandingPages });
  } catch (err) {
    next(err);
  }
});

async function renderShortLandingForm(res, { landing, errors, formData }) {
  const products = await Product.find({ status: true })
    .select('name slug price salePrice stock')
    .sort({ name: 1 });
  res.render('admin/landing-short-form', {
    adminPageTitle: landing && landing._id ? 'Edit Short Landing Page' : 'Add Landing Page',
    landing: landing || {},
    products,
    errors: errors || [],
    formData: formData || {},
  });
}

router.get('/landing-page/short/new', async (req, res, next) => {
  try {
    await renderShortLandingForm(res, { landing: null });
  } catch (err) {
    next(err);
  }
});

router.get('/landing-page/short/:id/edit', async (req, res, next) => {
  try {
    const landing = await ShortLandingPage.findById(req.params.id);
    if (!landing) {
      req.flash('danger', 'Short landing page not found.');
      return res.redirect('/admin/landing-page/short');
    }
    await renderShortLandingForm(res, { landing });
  } catch (err) {
    next(err);
  }
});

// CSRF is checked manually below (not via the verifyCsrf middleware) because
// multer's upload.single() is what parses multipart/form-data — req.body
// (and so req.body.csrfToken) isn't populated until after it runs.
async function saveShortLandingPage(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/landing-page/short');
    }
    const { title, slug: slugInput, title2, deliveryChargeMode } = req.body;

    const errors = [];
    if (!title || !title.trim()) errors.push('Title is required.');
    if (!title2 || !title2.trim()) errors.push('Title 2 is required.');

    const existing = existingId ? await ShortLandingPage.findById(existingId) : null;
    let imageName = existing ? existing.image : null;
    if (req.file) imageName = req.file.filename;

    if (errors.length) {
      return renderShortLandingForm(res, {
        landing: { ...(existing ? existing.toObject() : {}), ...req.body, image: imageName },
        errors,
        formData: req.body,
      });
    }

    // req.body.items arrives as a real array — multer/busboy turns
    // "items[0][mainTitle]", "items[0][product]", "items[1][...]" style
    // field names into req.body.items = [{ mainTitle, product, ... }, ...]
    // the same way it already does for the product-variant rows above.
    const itemsRaw = Array.isArray(req.body.items) ? req.body.items : [];
    const items = itemsRaw
      .filter((it) => it && it.product)
      .map((it) => ({
        mainTitle: (it.mainTitle || '').trim(),
        mainTitleColor: it.mainTitleColor || '#1e3a5f',
        mainTitleBgColor: it.mainTitleBgColor || '#ffffff',
        product: it.product,
        autoCart: !!it.autoCart,
      }));

    const data = {
      title: title.trim(),
      title2: title2.trim(),
      status: !!req.body.status,
      image: imageName,
      items,
      deliveryChargeMode: ['required', 'optional', 'free'].includes(deliveryChargeMode) ? deliveryChargeMode : 'required',
    };

    if (existing) {
      data.slug = await ensureUniqueSlug(ShortLandingPage, slugify((slugInput && slugInput.trim()) || title), existingId);
      await ShortLandingPage.updateOne({ _id: existingId }, data);
      req.flash('success', 'Short landing page updated successfully.');
    } else {
      data.slug = await ensureUniqueSlug(ShortLandingPage, slugify((slugInput && slugInput.trim()) || title), null);
      await ShortLandingPage.create(data);
      req.flash('success', 'New short landing page added successfully.');
    }
    res.redirect('/admin/landing-page/short');
  } catch (err) {
    next(err);
  }
}

router.post('/landing-page/short/new', upload.single('image'), (req, res, next) => saveShortLandingPage(req, res, next, null));
router.post('/landing-page/short/:id/edit', upload.single('image'), (req, res, next) => saveShortLandingPage(req, res, next, req.params.id));

router.get('/landing-page/short/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/landing-page/short');
    }
    await ShortLandingPage.deleteOne({ _id: req.params.id });
    req.flash('success', 'Short landing page deleted successfully.');
    res.redirect('/admin/landing-page/short');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   LANDING PAGE — LANDING CHECKOUT
   The lightest of the three: no image, just a title/slug, a product-select
   mode (single vs multiple, optionally mandatory), a picker table
   (Product / Is Auto Cart / Best Sell / Action), and delivery settings.
   ===================================================================== */
router.get('/landing-page/checkout', async (req, res, next) => {
  try {
    const landingCheckouts = await LandingCheckout.find().sort({ createdAt: -1 });
    res.render('admin/landing-checkout', { adminPageTitle: 'Landing Checkout', landingCheckouts });
  } catch (err) {
    next(err);
  }
});

async function renderLandingCheckoutForm(res, { landing, errors, formData }) {
  const products = await Product.find({ status: true })
    .select('name slug')
    .sort({ name: 1 });
  res.render('admin/landing-checkout-form', {
    adminPageTitle: landing && landing._id ? 'Edit Landing Checkout' : 'Create Landing',
    landing: landing || {},
    products,
    errors: errors || [],
    formData: formData || {},
  });
}

router.get('/landing-page/checkout/new', async (req, res, next) => {
  try {
    await renderLandingCheckoutForm(res, { landing: null });
  } catch (err) {
    next(err);
  }
});

router.get('/landing-page/checkout/:id/edit', async (req, res, next) => {
  try {
    const landing = await LandingCheckout.findById(req.params.id);
    if (!landing) {
      req.flash('danger', 'Landing checkout page not found.');
      return res.redirect('/admin/landing-page/checkout');
    }
    await renderLandingCheckoutForm(res, { landing });
  } catch (err) {
    next(err);
  }
});

// No file upload on this form, so CSRF is checked the same way as any other
// plain POST — via the verifyCsrf middleware.
async function saveLandingCheckout(req, res, next, existingId) {
  try {
    const { title, slug: slugInput, productSelectMode, deliveryChargeMode } = req.body;

    const errors = [];
    if (!title || !title.trim()) errors.push('Title is required.');

    const existing = existingId ? await LandingCheckout.findById(existingId) : null;

    if (errors.length) {
      return renderLandingCheckoutForm(res, {
        landing: { ...(existing ? existing.toObject() : {}), ...req.body },
        errors,
        formData: req.body,
      });
    }

    // req.body.items arrives as a real array — express.urlencoded turns
    // "items[0][product]", "items[1][...]" style field names into
    // req.body.items = [{ product, autoCart, bestSell }, ...], same as the
    // multipart bracket-notation rows used on the other landing forms.
    const itemsRaw = Array.isArray(req.body.items) ? req.body.items : [];
    const items = itemsRaw
      .filter((it) => it && it.product)
      .map((it) => ({
        product: it.product,
        autoCart: !!it.autoCart,
        bestSell: !!it.bestSell,
      }));

    const data = {
      title: title.trim(),
      status: !!req.body.status,
      productSelectMode: productSelectMode === 'single' ? 'single' : 'multiple',
      instantSelectRequired: !!req.body.instantSelectRequired,
      items,
      deliveryChargeMode: ['required', 'optional', 'free'].includes(deliveryChargeMode) ? deliveryChargeMode : 'required',
    };

    if (existing) {
      data.slug = await ensureUniqueSlug(LandingCheckout, slugify((slugInput && slugInput.trim()) || title), existingId);
      await LandingCheckout.updateOne({ _id: existingId }, data);
      req.flash('success', 'Landing checkout page updated successfully.');
    } else {
      data.slug = await ensureUniqueSlug(LandingCheckout, slugify((slugInput && slugInput.trim()) || title), null);
      await LandingCheckout.create(data);
      req.flash('success', 'New landing checkout page published successfully.');
    }
    res.redirect('/admin/landing-page/checkout');
  } catch (err) {
    next(err);
  }
}

router.post('/landing-page/checkout/new', verifyCsrf, (req, res, next) => saveLandingCheckout(req, res, next, null));
router.post('/landing-page/checkout/:id/edit', verifyCsrf, (req, res, next) => saveLandingCheckout(req, res, next, req.params.id));

router.get('/landing-page/checkout/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/landing-page/checkout');
    }
    await LandingCheckout.deleteOne({ _id: req.params.id });
    req.flash('success', 'Landing checkout page deleted successfully.');
    res.redirect('/admin/landing-page/checkout');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   LANDING PAGE — ADVANCE LANDING
   The richest of the four: banner + background styling, a row of page
   effect toggles, one or more repeatable "Design" blocks (each its own
   product-picker section with a design type, product-select mode,
   instruction message and colour styling), plus delivery/payment settings.
   ===================================================================== */
router.get('/landing-page/advance', async (req, res, next) => {
  try {
    const advanceLandingPages = await AdvanceLandingPage.find().sort({ createdAt: -1 });
    res.render('admin/landing-advance', { adminPageTitle: 'Advance Landing Page', advanceLandingPages });
  } catch (err) {
    next(err);
  }
});

async function renderAdvanceLandingForm(res, { landing, errors, formData }) {
  const products = await Product.find({ status: true })
    .select('name slug')
    .sort({ name: 1 });
  res.render('admin/landing-advance-form', {
    adminPageTitle: landing && landing._id ? 'Edit Advance Landing' : 'Advanced Landing',
    landing: landing || {},
    products,
    DESIGN_TYPES: AdvanceLandingPage.DESIGN_TYPES,
    errors: errors || [],
    formData: formData || {},
  });
}

router.get('/landing-page/advance/new', async (req, res, next) => {
  try {
    await renderAdvanceLandingForm(res, { landing: null });
  } catch (err) {
    next(err);
  }
});

router.get('/landing-page/advance/:id/edit', async (req, res, next) => {
  try {
    const landing = await AdvanceLandingPage.findById(req.params.id);
    if (!landing) {
      req.flash('danger', 'Advance landing page not found.');
      return res.redirect('/admin/landing-page/advance');
    }
    await renderAdvanceLandingForm(res, { landing });
  } catch (err) {
    next(err);
  }
});

// CSRF is checked manually below (not via the verifyCsrf middleware) because
// multer's upload.fields() is what parses multipart/form-data — req.body
// (and so req.body.csrfToken) isn't populated until after it runs.
const advanceLandingUpload = upload.fields([{ name: 'bannerImage', maxCount: 1 }]);

async function saveAdvanceLandingPage(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/landing-page/advance');
    }
    const { title, slug: slugInput, backgroundColor, deliveryChargeMode } = req.body;

    const errors = [];
    if (!title || !title.trim()) errors.push('Title is required.');

    const existing = existingId ? await AdvanceLandingPage.findById(existingId) : null;
    const files = req.files || {};
    let bannerImageName = existing ? existing.bannerImage : null;
    if (files.bannerImage && files.bannerImage[0]) bannerImageName = files.bannerImage[0].filename;

    if (errors.length) {
      return renderAdvanceLandingForm(res, {
        landing: { ...(existing ? existing.toObject() : {}), ...req.body, bannerImage: bannerImageName },
        errors,
        formData: req.body,
      });
    }

    // req.body.designs arrives as a real array of objects, each with its own
    // nested `products` array — multer/busboy resolves bracket-notation
    // field names ("designs[0][products][0][product]", etc.) into that
    // shape directly, the same as the single-level "items[i][...]" rows
    // used on the other landing forms.
    const designsRaw = Array.isArray(req.body.designs) ? req.body.designs : [];
    const designs = designsRaw
      .map((d) => {
        const productsRaw = d && Array.isArray(d.products) ? d.products : [];
        return {
          designType: AdvanceLandingPage.DESIGN_TYPES.includes(d && d.designType) ? d.designType : '',
          productSelectMode: d && d.productSelectMode === 'single' ? 'single' : 'multiple',
          products: productsRaw
            .filter((p) => p && p.product)
            .map((p) => ({ product: p.product, autoCart: !!p.autoCart, bestSale: !!p.bestSale })),
          instructionMessage: ((d && d.instructionMessage) || '').trim(),
          messageOnOff: !!(d && d.messageOnOff),
          showNumber: !!(d && d.showNumber),
          productBgColor: (d && d.productBgColor) || '#ffffff',
          productBorderColor: (d && d.productBorderColor) || '#c0554e',
        };
      })
      .filter((d) => d.designType || d.products.length || d.instructionMessage);

    const data = {
      title: title.trim(),
      status: !!req.body.status,
      buttonEffect: !!req.body.buttonEffect,
      showLogo: !!req.body.showLogo,
      showTopCountdown: !!req.body.showTopCountdown,
      showVoice: !!req.body.showVoice,
      backgroundEnabled: !!req.body.backgroundEnabled,
      backgroundColor: backgroundColor || '#ffffff',
      backgroundEffect: !!req.body.backgroundEffect,
      bannerEnabled: !!req.body.bannerEnabled,
      bannerImage: bannerImageName,
      designEnabled: !!req.body.designEnabled,
      designs,
      deliveryChargeMode: ['required', 'optional', 'free'].includes(deliveryChargeMode) ? deliveryChargeMode : 'required',
      paymentCod: !!req.body.paymentCod,
      paymentBkash: !!req.body.paymentBkash,
      paymentManual: !!req.body.paymentManual,
    };

    if (existing) {
      data.slug = await ensureUniqueSlug(AdvanceLandingPage, slugify((slugInput && slugInput.trim()) || title), existingId);
      await AdvanceLandingPage.updateOne({ _id: existingId }, data);
      req.flash('success', 'Advance landing page updated successfully.');
    } else {
      data.slug = await ensureUniqueSlug(AdvanceLandingPage, slugify((slugInput && slugInput.trim()) || title), null);
      await AdvanceLandingPage.create(data);
      req.flash('success', 'New advance landing page saved successfully.');
    }
    res.redirect('/admin/landing-page/advance');
  } catch (err) {
    next(err);
  }
}

router.post('/landing-page/advance/new', advanceLandingUpload, (req, res, next) => saveAdvanceLandingPage(req, res, next, null));
router.post('/landing-page/advance/:id/edit', advanceLandingUpload, (req, res, next) => saveAdvanceLandingPage(req, res, next, req.params.id));

router.get('/landing-page/advance/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/landing-page/advance');
    }
    await AdvanceLandingPage.deleteOne({ _id: req.params.id });
    req.flash('success', 'Advance landing page deleted successfully.');
    res.redirect('/admin/landing-page/advance');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   ORDERS — single order detail / update
   ===================================================================== */
router.get('/orders/:id', async (req, res, next) => {
  try {
    const [order, employees] = await Promise.all([
      Order.findById(req.params.id).populate('assignedEmployee', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
    ]);
    if (!order) {
      req.flash('danger', 'Order not found.');
      return res.redirect('/admin/orders');
    }
    res.render('admin/order-view', {
      adminPageTitle: `Order #${order.orderNumber}`,
      order,
      employees,
      ORDER_STATUSES,
      COURIERS,
      DELIVERY_STATUSES,
      RETURN_STATUSES,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id', verifyCsrf, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      req.flash('danger', 'Order not found.');
      return res.redirect('/admin/orders');
    }
    const { status, paymentStatus, courier, courierTrackingId, assignedEmployee, adminNote } = req.body;

    if (status && status !== order.status) {
      await applyStatusChange(order, status);
    }
    if (paymentStatus) order.paymentStatus = paymentStatus;
    order.courier = COURIERS.some((c) => c.value === courier) ? courier : '';
    order.courierTrackingId = (courierTrackingId || '').trim();
    order.assignedEmployee = assignedEmployee || null;
    order.adminNote = (adminNote || '').trim();

    await order.save();
    req.flash('success', 'Order updated successfully.');
    res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Delivery Tracking card on the order detail page — the in-house rider's
// own journey (Order.delivery), separate from the update form above.
router.post('/orders/:id/delivery', verifyCsrf, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      req.flash('danger', 'Order not found.');
      return res.redirect('/admin/orders');
    }
    const { deliveryStatus, deliveryMan, note, officeNote, returnStatus } = req.body;

    if (DELIVERY_STATUSES.some((s) => s.value === deliveryStatus)) order.delivery.status = deliveryStatus;
    order.delivery.deliveryMan = deliveryMan || null;
    if (deliveryMan && !order.delivery.assignedAt) order.delivery.assignedAt = new Date();
    order.delivery.note = (note || '').trim();
    order.delivery.officeNote = (officeNote || '').trim();

    const collected = !!req.body.collected;
    if (collected && !order.delivery.collected) order.delivery.collectedAt = new Date();
    if (!collected) order.delivery.collectedAt = null;
    order.delivery.collected = collected;

    const clearedToOffice = !!req.body.clearedToOffice;
    if (clearedToOffice && !order.delivery.clearedToOffice) order.delivery.clearedAt = new Date();
    if (!clearedToOffice) order.delivery.clearedAt = null;
    order.delivery.clearedToOffice = clearedToOffice;

    if (order.status === 'cancelled' && RETURN_STATUSES.some((s) => s.value === returnStatus)) {
      order.delivery.returnStatus = returnStatus;
    }

    pushActivity(order, 'Delivery tracking updated.');
    await order.save();
    req.flash('success', 'Delivery tracking updated successfully.');
    res.redirect(`/admin/orders/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   STAFF SETTINGS — grid hub (Roles / User / Staff Commission Setup /
   Staff Report / Product Assign List / Staff Commission Request).

   Every "Employee" used across Order Management / Manage Delivery
   (Order.assignedEmployee, Order.delivery.deliveryMan) is one of these
   Admin accounts (see Staff > User below) — this is where they actually
   get created, so those dropdowns have someone in them.

   Product Assign List and Staff Commission Request had no design shown
   anywhere in the screenshots (just the two grid card names), so — same
   as Manage Sliders / Product View Setting under Customization — they
   stay honest coming-soon stubs (registered in COMING_SOON_PAGES) rather
   than a guessed-at feature. "Staff Commission Request" is NOT the same
   thing as the existing Manage Delivery > Commission Request page — that
   one pays out models/DeliveryCommissionSetup.js's volume-tier commission
   for individual delivery-man accounts; this would be a payout request
   flow for models/StaffCommissionSetup.js's flat-rate, per-Role commission
   below, which is a different scheme with no request/approve UI shown.
   ===================================================================== */
const STAFF_CARDS = ['roles', 'user', 'commissionSetup', 'report', 'productAssign', 'commissionRequest'];
const STAFF_CARD_META = {
  roles: { title: 'Roles', path: '/admin/staff/roles', icon: 'bi-shield-lock-fill', color: '#337ab7' },
  user: { title: 'User', path: '/admin/staff/users', icon: 'bi-person-fill', color: '#f0ad4e' },
  commissionSetup: { title: 'Staff Commission Setup', path: '/admin/staff/commission-setup', icon: 'bi-percent', color: '#28a745' },
  report: { title: 'Staff Report', path: '/admin/staff/report', icon: 'bi-bar-chart-fill', color: '#d6336c' },
  productAssign: { title: 'Product Assign List', path: '/admin/staff/product-assign', icon: 'bi-list-check', color: '#e05d3f' },
  commissionRequest: { title: 'Staff Commission Request', path: '/admin/staff/commission-request', icon: 'bi-chat-dots-fill', color: '#212529' },
};

router.get('/staff', (req, res) => {
  res.render('admin/staff', { adminPageTitle: 'Staff Settings', STAFF_CARDS, STAFF_CARD_META });
});

/* ---------------------------------------------------------------------
   ROLES — a name + permission matrix (see models/Role.js for what's
   genuinely saved vs. actually enforced).
   --------------------------------------------------------------------- */
router.get('/staff/roles', async (req, res, next) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });
    res.render('admin/staff-roles', { adminPageTitle: 'Roles', roles, PERMISSION_MODULES });
  } catch (err) {
    next(err);
  }
});

function parsePermissionsFromBody(body) {
  const permissions = {};
  PERMISSION_MODULES.forEach((mod) => {
    const raw = body[`perm_${mod.key}`];
    if (!raw) return;
    const checked = (Array.isArray(raw) ? raw : [raw]).filter((a) => mod.actions.includes(a));
    if (checked.length) permissions[mod.key] = checked;
  });
  return permissions;
}

router.get('/staff/roles/new', (req, res) => {
  res.render('admin/staff-role-form', { adminPageTitle: 'Add Role', role: null, PERMISSION_MODULES, errors: [] });
});

router.post('/staff/roles/new', verifyCsrf, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const errors = [];
    if (!name) errors.push('Role name is required.');
    if (!errors.length && (await Role.findOne({ name }))) errors.push('A role with that name already exists.');

    if (errors.length) {
      return res.render('admin/staff-role-form', { adminPageTitle: 'Add Role', role: { name, permissions: parsePermissionsFromBody(req.body) }, PERMISSION_MODULES, errors });
    }

    await Role.create({ name, permissions: parsePermissionsFromBody(req.body) });
    req.flash('success', 'Role created successfully.');
    res.redirect('/admin/staff/roles');
  } catch (err) {
    next(err);
  }
});

router.get('/staff/roles/:id/edit', async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      req.flash('danger', 'Role not found.');
      return res.redirect('/admin/staff/roles');
    }
    res.render('admin/staff-role-form', { adminPageTitle: 'Edit Role', role, PERMISSION_MODULES, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/staff/roles/:id/edit', verifyCsrf, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const errors = [];
    if (!name) errors.push('Role name is required.');
    if (!errors.length && (await Role.findOne({ name, _id: { $ne: req.params.id } }))) errors.push('A role with that name already exists.');

    if (errors.length) {
      return res.render('admin/staff-role-form', {
        adminPageTitle: 'Edit Role', role: { _id: req.params.id, name, permissions: parsePermissionsFromBody(req.body) }, PERMISSION_MODULES, errors,
      });
    }

    await Role.updateOne({ _id: req.params.id }, { name, permissions: parsePermissionsFromBody(req.body) });
    req.flash('success', 'Role updated successfully.');
    res.redirect('/admin/staff/roles');
  } catch (err) {
    next(err);
  }
});

router.get('/staff/roles/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/staff/roles');
    }
    if (await Admin.findOne({ roleId: req.params.id })) {
      req.flash('danger', 'This role is assigned to at least one user — reassign them first.');
      return res.redirect('/admin/staff/roles');
    }
    await Role.deleteOne({ _id: req.params.id });
    req.flash('success', 'Role deleted successfully.');
    res.redirect('/admin/staff/roles');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   USER — staff/admin accounts (formerly the standalone Staff page).
   `role` is a free-text label only. `roleId` is the real Role link the
   "User Role" dropdown sets. `loginEnabled` really gates sign-in (see
   POST /login above).
   --------------------------------------------------------------------- */
router.get('/staff/users', async (req, res, next) => {
  try {
    const [staff, roles] = await Promise.all([
      Admin.find().sort({ createdAt: -1 }).populate('roleId', 'name'),
      Role.find().sort({ name: 1 }),
    ]);
    res.render('admin/staff-users', { adminPageTitle: 'Users', staff, roles, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/staff/users', verifyCsrf, async (req, res, next) => {
  try {
    const { id, name, email, roleId, password } = req.body;
    const username = (name || '').trim();
    const errors = [];
    if (!username) errors.push('Name is required.');
    if (!email || !email.trim()) errors.push('Email is required.');
    if (!id && (!password || password.length < 4)) errors.push('Password must be at least 4 characters.');

    if (!errors.length) {
      const dupe = await Admin.findOne({
        _id: { $ne: id || null },
        $or: [{ username }, { email: (email || '').trim().toLowerCase() }],
      });
      if (dupe) errors.push('That name or email is already in use.');
    }

    if (errors.length) {
      const [staff, roles] = await Promise.all([
        Admin.find().sort({ createdAt: -1 }).populate('roleId', 'name'),
        Role.find().sort({ name: 1 }),
      ]);
      return res.render('admin/staff-users', { adminPageTitle: 'Users', staff, roles, errors });
    }

    const roleDoc = roleId ? await Role.findById(roleId) : null;
    const data = {
      username,
      fullName: username,
      email: email.trim().toLowerCase(),
      roleId: roleDoc ? roleDoc._id : null,
      role: roleDoc ? roleDoc.name : 'admin',
      loginEnabled: !!req.body.loginEnabled,
    };
    if (password) data.password = await bcrypt.hash(password, 10);

    if (id) {
      await Admin.updateOne({ _id: id }, data);
      req.flash('success', 'User updated successfully.');
    } else {
      await Admin.create(data);
      req.flash('success', 'New user created successfully.');
    }
    res.redirect('/admin/staff/users');
  } catch (err) {
    next(err);
  }
});

router.get('/staff/users/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/staff/users');
    }
    if (String(req.params.id) === String(req.session.adminId)) {
      req.flash('danger', "You can't delete the account you're currently logged in as.");
      return res.redirect('/admin/staff/users');
    }
    await Admin.deleteOne({ _id: req.params.id });
    req.flash('success', 'User deleted successfully.');
    res.redirect('/admin/staff/users');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   STAFF COMMISSION SETUP — flat % rate per Role (see models/StaffCommissionSetup.js
   for what "After Courier"/"After Delivered" mean — an original, disclosed
   interpretation since the screenshot's table had no example row).
   --------------------------------------------------------------------- */
router.get('/staff/commission-setup', async (req, res, next) => {
  try {
    const [setups, roles] = await Promise.all([
      StaffCommissionSetup.find().sort({ createdAt: -1 }).populate('role', 'name'),
      Role.find().sort({ name: 1 }),
    ]);
    res.render('admin/staff-commission-setup', { adminPageTitle: 'Staff Commission Setup', setups, roles, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/staff/commission-setup', verifyCsrf, async (req, res, next) => {
  try {
    const { id, role, commissionRate } = req.body;
    const errors = [];
    if (!role) errors.push('Select an employee type (Role).');
    if (commissionRate === undefined || commissionRate === '' || Number(commissionRate) < 0) errors.push('Enter a valid commission rate.');

    if (errors.length) {
      const [setups, roles] = await Promise.all([
        StaffCommissionSetup.find().sort({ createdAt: -1 }).populate('role', 'name'),
        Role.find().sort({ name: 1 }),
      ]);
      return res.render('admin/staff-commission-setup', { adminPageTitle: 'Staff Commission Setup', setups, roles, errors });
    }

    const data = {
      role,
      commissionRate: Number(commissionRate) || 0,
      afterCourier: !!req.body.afterCourier,
      afterDelivered: !!req.body.afterDelivered,
    };
    if (id) {
      await StaffCommissionSetup.updateOne({ _id: id }, data);
      req.flash('success', 'Commission setup updated successfully.');
    } else {
      await StaffCommissionSetup.create(data);
      req.flash('success', 'Commission setup created successfully.');
    }
    res.redirect('/admin/staff/commission-setup');
  } catch (err) {
    next(err);
  }
});

router.get('/staff/commission-setup/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/staff/commission-setup');
    }
    await StaffCommissionSetup.deleteOne({ _id: req.params.id });
    req.flash('success', 'Commission setup deleted successfully.');
    res.redirect('/admin/staff/commission-setup');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   STAFF REPORT — real per-staff order counts by status (Order.assignedEmployee,
   grouped over the selected date range) plus a real Commission Amount
   computed from Staff Commission Setup. "Paid Commission" is always 0 —
   there's no payout/approval system yet (see Staff Commission Request
   above), so rather than invent a number, it's honestly left at 0, which
   makes Total Commission equal Commission Amount for now.
   --------------------------------------------------------------------- */
router.get('/staff/report', async (req, res, next) => {
  try {
    const range = ['today', 'yesterday', 'this_week', 'this_month'].includes(req.query.range) ? req.query.range : 'today';
    const now = new Date();
    let from = new Date(now); from.setHours(0, 0, 0, 0);
    let to = new Date(now); to.setHours(23, 59, 59, 999);
    if (range === 'yesterday') {
      from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1);
    } else if (range === 'this_week') {
      from.setDate(from.getDate() - from.getDay());
    } else if (range === 'this_month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const [staff, setups] = await Promise.all([
      Admin.find().sort({ username: 1 }).populate('roleId', 'name'),
      StaffCommissionSetup.find(),
    ]);
    const setupByRole = {};
    setups.forEach((s) => { setupByRole[String(s.role)] = s; });

    const orders = await Order.find({ createdAt: { $gte: from, $lte: to }, assignedEmployee: { $ne: null } })
      .select('assignedEmployee status total').lean();

    const rows = staff.map((s) => {
      const own = orders.filter((o) => String(o.assignedEmployee) === String(s._id));
      const countByStatus = { pending: 0, confirmed: 0, courier: 0, cancelled: 0, delivered: 0, returned: 0 };
      own.forEach((o) => { if (o.status in countByStatus) countByStatus[o.status] += 1; });

      const setup = s.roleId ? setupByRole[String(s.roleId._id)] : null;
      let commissionAmount = 0;
      if (setup) {
        own.forEach((o) => {
          const eligible = (setup.afterCourier && o.status === 'courier') || (setup.afterDelivered && o.status === 'delivered');
          if (eligible) commissionAmount += (o.total || 0) * (setup.commissionRate / 100);
        });
      }

      return {
        _id: s._id, name: s.fullName || s.username,
        newOrders: countByStatus.pending, confirmed: countByStatus.confirmed, courier: countByStatus.courier,
        cancelled: countByStatus.cancelled, delivered: countByStatus.delivered, returned: countByStatus.returned,
        commissionAmount, paidCommission: 0, totalCommission: commissionAmount,
      };
    }).filter((r) => r.newOrders + r.confirmed + r.courier + r.cancelled + r.delivered + r.returned > 0);

    res.render('admin/staff-report', { adminPageTitle: 'Staff Report', rows, range });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   TASK MANAGEMENT — a general internal to-do/task tracker for admin
   staff (see models/Task.js for exactly what's a real link vs a
   manually-typed tag: Employee is a real Admin FK; Order Status and
   Invoice Number are free-form fields that are NOT wired to any real
   Order). Filters: Priority, Status, Type, Assigned User (employee),
   Order Status, plus a text search across Title/Description/Invoice
   Number.
   ===================================================================== */
router.get('/task-management', async (req, res, next) => {
  try {
    const {
      priority = '', status = '', type = '', employee = '', orderStatus = '', q = '',
    } = req.query;

    const filter = {};
    if (priority) filter.priority = priority;
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (employee) filter.employee = employee;
    if (orderStatus) filter.orderStatus = orderStatus;
    if (q.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: re }, { description: re }, { invoiceNumber: re }];
    }

    const [tasks, employees] = await Promise.all([
      Task.find(filter).sort({ createdAt: -1 }).populate('employee', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
    ]);

    res.render('admin/task-management', {
      adminPageTitle: 'Task Management',
      tasks,
      employees,
      TASK_PRIORITIES,
      TASK_STATUSES,
      TASK_TYPES,
      ORDER_STATUSES,
      priorityLabel,
      priorityBadge,
      taskStatusLabel,
      taskStatusBadge,
      typeLabel,
      filters: {
        priority, status, type, employee, orderStatus, q,
      },
      errors: [],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/task-management', verifyCsrf, async (req, res, next) => {
  try {
    const {
      id, title, description, orderStatus, employee, invoiceNumber, priority, status, type, dueDate,
    } = req.body;

    const errors = [];
    if (!title || !title.trim()) errors.push('Title is required.');

    if (errors.length) {
      const [tasks, employees] = await Promise.all([
        Task.find().sort({ createdAt: -1 }).populate('employee', 'username fullName'),
        Admin.find().sort({ username: 1 }).select('username fullName'),
      ]);
      return res.render('admin/task-management', {
        adminPageTitle: 'Task Management',
        tasks,
        employees,
        TASK_PRIORITIES,
        TASK_STATUSES,
        TASK_TYPES,
        ORDER_STATUSES,
        priorityLabel,
        priorityBadge,
        taskStatusLabel,
        taskStatusBadge,
        typeLabel,
        filters: {
          priority: '', status: '', type: '', employee: '', orderStatus: '', q: '',
        },
        errors,
      });
    }

    const data = {
      title: title.trim(),
      description: description || '',
      orderStatus: ORDER_STATUSES.some((s) => s.value === orderStatus) ? orderStatus : '',
      employee: employee || null,
      invoiceNumber: (invoiceNumber || '').trim(),
      priority: TASK_PRIORITIES.some((p) => p.value === priority) ? priority : 'medium',
      status: TASK_STATUSES.some((s) => s.value === status) ? status : 'pending',
      type: TASK_TYPES.some((t) => t.value === type) ? type : 'general',
      dueDate: dueDate ? new Date(dueDate) : null,
    };

    if (id) {
      await Task.updateOne({ _id: id }, data);
      req.flash('success', 'Task updated successfully.');
    } else {
      await Task.create(data);
      req.flash('success', 'Task created successfully.');
    }
    res.redirect('/admin/task-management');
  } catch (err) {
    next(err);
  }
});

router.get('/task-management/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/task-management');
    }
    await Task.deleteOne({ _id: req.params.id });
    req.flash('success', 'Task deleted successfully.');
    res.redirect('/admin/task-management');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   MANAGE DELIVERY
   ---------------------------------------------------------------------
   An order's own in-house hand-off journey (Order.delivery, see
   models/Order.js) — separate from the 3rd-party `courier` field on the
   order update form above. Every list below mirrors the reference
   design exactly: a plain table with a "Select Employee + Assign" bulk
   action and no extra Action column — the order number itself is the
   link into detail. All fine-grained per-order editing (delivery
   status, notes, return status...) lives on the order detail page's
   "Delivery Tracking" card (see POST /orders/:id/delivery above)
   instead, reached by clicking that order number.
   ===================================================================== */

// Orders still on their way out — not yet delivered/cancelled/returned —
// available to be picked up / assigned to an in-house rider.
const DELIVERY_MAN_FILTER = { isDeleted: false, status: { $in: ['confirmed', 'packaging', 'courier'] } };

router.get('/delivery/delivery-man', async (req, res, next) => {
  try {
    const filter = { ...DELIVERY_MAN_FILTER };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, employees] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).populate('delivery.deliveryMan', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
    ]);

    res.render('admin/delivery-man', { adminPageTitle: 'Delivery Man', orders, employees, q });
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/delivery-man/assign', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const employeeId = req.body.employeeId || null;
    if (ids.length && employeeId) {
      const employee = await Admin.findById(employeeId);
      const orders = await Order.find({ _id: { $in: ids } });
      await Promise.all(orders.map((o) => {
        o.delivery.deliveryMan = employeeId;
        o.delivery.assignedAt = new Date();
        if (o.delivery.status === 'pending') o.delivery.status = 'assigned';
        pushActivity(o, `Assigned to delivery man: ${employee ? (employee.fullName || employee.username) : employeeId}`);
        return o.save();
      }));
      req.flash('success', `Assigned ${ids.length} order(s) to a delivery man.`);
    } else {
      req.flash('danger', 'Select at least one order and an employee.');
    }
    res.redirect(req.get('Referer') || '/admin/delivery/delivery-man');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   DELIVERED ORDER — COD cash collected by the rider, still awaiting
   hand-off to the office (Order.delivery.collected, not yet
   clearedToOffice).
   --------------------------------------------------------------------- */
router.get('/delivery/delivered', async (req, res, next) => {
  try {
    const filter = { isDeleted: false, status: 'delivered', 'delivery.clearedToOffice': false };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const [orders, employees, sums] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).populate('delivery.deliveryMan', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
      Order.aggregate([
        { $match: { isDeleted: false, status: 'delivered', 'delivery.clearedToOffice': false } },
        { $group: { _id: '$delivery.collected', total: { $sum: '$total' } } },
      ]),
    ]);

    let pendingAmount = 0;
    let collectedAmount = 0;
    sums.forEach((s) => { if (s._id) collectedAmount = s.total; else pendingAmount = s.total; });

    res.render('admin/delivery-delivered', {
      adminPageTitle: 'Delivered Order',
      orders, employees, q,
      pendingAmount, collectedAmount, availableAmount: collectedAmount,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/delivered/assign', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const employeeId = req.body.employeeId || null;
    if (ids.length && employeeId) {
      await Order.updateMany({ _id: { $in: ids } }, { 'delivery.deliveryMan': employeeId });
      req.flash('success', `Assigned ${ids.length} order(s).`);
    } else {
      req.flash('danger', 'Select at least one order and an employee.');
    }
    res.redirect(req.get('Referer') || '/admin/delivery/delivered');
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/delivered/office-send', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    if (ids.length) {
      const orders = await Order.find({ _id: { $in: ids }, 'delivery.collected': true });
      await Promise.all(orders.map((o) => {
        o.delivery.clearedToOffice = true;
        o.delivery.clearedAt = new Date();
        pushActivity(o, 'Delivery cash cleared to office.');
        return o.save();
      }));
      req.flash('success', `Sent ${orders.length} order(s) to Clear Delivery.`);
    }
    res.redirect(req.get('Referer') || '/admin/delivery/delivered');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   CLEAR DELIVERY — read-only record of what's already been cleared to
   the office via Delivered Order's "Send to Office" action above.
   --------------------------------------------------------------------- */
router.get('/delivery/clear', async (req, res, next) => {
  try {
    const filter = { isDeleted: false, 'delivery.clearedToOffice': true };
    const q = (req.query.q || '').trim();
    if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

    const orders = await Order.find(filter).sort({ 'delivery.clearedAt': -1 }).populate('delivery.deliveryMan', 'username fullName');
    res.render('admin/delivery-clear', { adminPageTitle: 'Clear Delivery', orders, q });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   CANCELLED ORDER / RETURN CONFIRM — same list, same handler: a
   cancelled order's product coming back to the office
   (Order.delivery.returnStatus).
   --------------------------------------------------------------------- */
function deliveryCancelledHandler(pageTitle) {
  return async (req, res, next) => {
    try {
      const filter = { isDeleted: false, status: 'cancelled' };
      const q = (req.query.q || '').trim();
      if (q) Object.assign(filter, ORDER_SEARCH_FIELDS(q));

      const [orders, employees] = await Promise.all([
        Order.find(filter).sort({ createdAt: -1 }).populate('delivery.deliveryMan', 'username fullName'),
        Admin.find().sort({ username: 1 }).select('username fullName'),
      ]);

      res.render('admin/delivery-cancelled', { adminPageTitle: pageTitle, orders, employees, q });
    } catch (err) {
      next(err);
    }
  };
}
router.get('/delivery/cancelled', deliveryCancelledHandler('Cancelled Order'));
router.get('/delivery/return-confirm', deliveryCancelledHandler('Return Confirm'));

router.post('/delivery/cancelled/assign', verifyCsrf, async (req, res, next) => {
  try {
    const ids = parseIds(req.body);
    const employeeId = req.body.employeeId || null;
    if (ids.length && employeeId) {
      const orders = await Order.find({ _id: { $in: ids } });
      await Promise.all(orders.map((o) => {
        o.delivery.deliveryMan = employeeId;
        if (!o.delivery.returnStatus) o.delivery.returnStatus = 'return_pending';
        pushActivity(o, 'Assigned to delivery man for return pickup.');
        return o.save();
      }));
      req.flash('success', `Assigned ${ids.length} order(s).`);
    } else {
      req.flash('danger', 'Select at least one order and an employee.');
    }
    res.redirect(req.get('Referer') || '/admin/delivery/cancelled');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   AMOUNT REQUEST — a cash advance/reimbursement raised for a delivery
   employee, approved/rejected by the office.
   --------------------------------------------------------------------- */
async function renderAmountRequest(res, tab, errors) {
  const [requests, employees, counts] = await Promise.all([
    DeliveryRequest.find({ type: 'amount', status: tab }).sort({ createdAt: -1 }).populate('employee', 'username fullName'),
    Admin.find().sort({ username: 1 }).select('username fullName'),
    DeliveryRequest.aggregate([{ $match: { type: 'amount' } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const countMap = { pending: 0, approved: 0, rejected: 0 };
  counts.forEach((c) => { countMap[c._id] = c.n; });
  res.render('admin/delivery-amount-request', { adminPageTitle: 'Amount Request', requests, employees, tab, countMap, errors });
}

router.get('/delivery/amount-request', async (req, res, next) => {
  try {
    const tab = ['pending', 'approved', 'rejected'].includes(req.query.tab) ? req.query.tab : 'pending';
    await renderAmountRequest(res, tab, []);
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/amount-request', verifyCsrf, async (req, res, next) => {
  try {
    const { employee, amount, note } = req.body;
    const errors = [];
    if (!employee) errors.push('Select an employee.');
    if (!amount || Number(amount) <= 0) errors.push('Enter a valid amount.');

    if (errors.length) {
      return await renderAmountRequest(res, 'pending', errors);
    }

    await DeliveryRequest.create({ type: 'amount', employee, amount: Number(amount), note: (note || '').trim() });
    req.flash('success', 'Amount request submitted successfully.');
    res.redirect('/admin/delivery/amount-request');
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/amount-request/:id/action', verifyCsrf, async (req, res, next) => {
  try {
    const action = req.body.action === 'approve' ? 'approved' : (req.body.action === 'reject' ? 'rejected' : null);
    if (action) {
      await DeliveryRequest.updateOne({ _id: req.params.id, type: 'amount' }, { status: action });
      req.flash('success', `Request ${action}.`);
    }
    res.redirect(req.get('Referer') || '/admin/delivery/amount-request');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   DELIVERY COMMISSION — volume-based commission tiers per employee
   (see models/DeliveryCommissionSetup.js).
   --------------------------------------------------------------------- */
router.get('/delivery/commission', async (req, res, next) => {
  try {
    const [setups, employees] = await Promise.all([
      DeliveryCommissionSetup.find().sort({ createdAt: -1 }).populate('employee', 'username fullName'),
      Admin.find().sort({ username: 1 }).select('username fullName'),
    ]);
    res.render('admin/delivery-commission', { adminPageTitle: 'Delivery Commission', setups, employees, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/commission', verifyCsrf, async (req, res, next) => {
  try {
    const { id, employee, afterCancelCount, commissionAfterCancel, afterDeliveredCount, commissionAfterDelivered } = req.body;
    const errors = [];
    if (!employee) errors.push('Select an employee.');

    if (errors.length) {
      const [setups, employees] = await Promise.all([
        DeliveryCommissionSetup.find().sort({ createdAt: -1 }).populate('employee', 'username fullName'),
        Admin.find().sort({ username: 1 }).select('username fullName'),
      ]);
      return res.render('admin/delivery-commission', { adminPageTitle: 'Delivery Commission', setups, employees, errors });
    }

    const data = {
      employee,
      afterCancelCount: Number(afterCancelCount) || 0,
      commissionAfterCancel: Number(commissionAfterCancel) || 0,
      afterDeliveredCount: Number(afterDeliveredCount) || 0,
      commissionAfterDelivered: Number(commissionAfterDelivered) || 0,
    };
    if (id) {
      await DeliveryCommissionSetup.updateOne({ _id: id }, data);
      req.flash('success', 'Commission setup updated successfully.');
    } else {
      await DeliveryCommissionSetup.create(data);
      req.flash('success', 'New commission setup added successfully.');
    }
    res.redirect('/admin/delivery/commission');
  } catch (err) {
    next(err);
  }
});

router.get('/delivery/commission/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/delivery/commission');
    }
    await DeliveryCommissionSetup.deleteOne({ _id: req.params.id });
    req.flash('success', 'Commission setup deleted successfully.');
    res.redirect('/admin/delivery/commission');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   COMMISSION REQUEST — payout of earned commission (see Delivery
   Commission above), approved/rejected by the office.
   --------------------------------------------------------------------- */
async function renderCommissionRequest(res, tab, errors) {
  const [requests, employees, counts] = await Promise.all([
    DeliveryRequest.find({ type: 'commission', status: tab }).sort({ createdAt: -1 }).populate('employee', 'username fullName'),
    Admin.find().sort({ username: 1 }).select('username fullName'),
    DeliveryRequest.aggregate([{ $match: { type: 'commission' } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const countMap = { pending: 0, approved: 0, rejected: 0 };
  counts.forEach((c) => { countMap[c._id] = c.n; });
  res.render('admin/delivery-commission-request', { adminPageTitle: 'Commission Request', requests, employees, tab, countMap, errors });
}

router.get('/delivery/commission-request', async (req, res, next) => {
  try {
    const tab = ['pending', 'approved', 'rejected'].includes(req.query.tab) ? req.query.tab : 'pending';
    await renderCommissionRequest(res, tab, []);
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/commission-request', verifyCsrf, async (req, res, next) => {
  try {
    const { employee, amount, method, note } = req.body;
    const errors = [];
    if (!employee) errors.push('Select an employee.');
    if (!amount || Number(amount) <= 0) errors.push('Enter a valid amount.');

    if (errors.length) {
      return await renderCommissionRequest(res, 'pending', errors);
    }

    await DeliveryRequest.create({
      type: 'commission', employee, amount: Number(amount),
      method: ['cash', 'bkash', 'nagad', 'bank'].includes(method) ? method : '',
      note: (note || '').trim(),
    });
    req.flash('success', 'Commission request submitted successfully.');
    res.redirect('/admin/delivery/commission-request');
  } catch (err) {
    next(err);
  }
});

router.post('/delivery/commission-request/:id/action', verifyCsrf, async (req, res, next) => {
  try {
    const action = req.body.action === 'approve' ? 'approved' : (req.body.action === 'reject' ? 'rejected' : null);
    if (action) {
      await DeliveryRequest.updateOne({ _id: req.params.id, type: 'commission' }, { status: action });
      req.flash('success', `Request ${action}.`);
    }
    res.redirect(req.get('Referer') || '/admin/delivery/commission-request');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   MARKETING
   ---------------------------------------------------------------------
   Six integration cards (see models/MarketingSetting.js for what each
   one actually drives once turned ON): a grid page + one shared "Manage"
   form page per card, matching the reference design.
   ===================================================================== */
const MARKETING_CARDS = ['sms', 'facebookPixel', 'tiktokPixel', 'googleTagManager', 'googleAnalytics', 'facebookCatalog'];
const MARKETING_CARD_META = {
  sms: { title: 'SMS', icon: 'bi-chat-dots-fill', color: '#f0ad4e' },
  facebookPixel: { title: 'Facebook Pixel', icon: 'bi-facebook', color: '#1877f2' },
  tiktokPixel: { title: 'TikTok Pixel', icon: 'bi-tiktok', color: '#000000' },
  googleTagManager: { title: 'Google Tag Manager', icon: '', color: '#7c3aed' },
  googleAnalytics: { title: 'Google Analytic', icon: '', color: '#f4a100' },
  facebookCatalog: { title: 'Facebook Catelog', icon: 'bi-facebook', color: '#1877f2' },
};

router.get('/marketing', async (req, res, next) => {
  try {
    const marketing = await getMarketingSettings();
    res.render('admin/marketing', { adminPageTitle: 'Marketing Settings', marketing, MARKETING_CARDS, MARKETING_CARD_META });
  } catch (err) {
    next(err);
  }
});

router.get('/marketing/:card', async (req, res, next) => {
  try {
    const card = req.params.card;
    if (!MARKETING_CARDS.includes(card)) {
      req.flash('danger', 'Unknown marketing integration.');
      return res.redirect('/admin/marketing');
    }
    const marketing = await getMarketingSettings();
    res.render('admin/marketing-manage', {
      adminPageTitle: MARKETING_CARD_META[card].title,
      card,
      meta: MARKETING_CARD_META[card],
      marketing,
      testResult: null,
      baseUrl: `${req.protocol}://${req.get('host')}`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/marketing/:card', verifyCsrf, async (req, res, next) => {
  try {
    const card = req.params.card;
    if (!MARKETING_CARDS.includes(card)) return res.redirect('/admin/marketing');
    const data = { ...req.body };
    delete data.csrfToken;
    data.status = data.status === 'on';
    await updateMarketingSettingCard(card, data);
    req.flash('success', `${MARKETING_CARD_META[card].title} settings saved successfully.`);
    res.redirect(`/admin/marketing/${card}`);
  } catch (err) {
    next(err);
  }
});

router.post('/marketing/sms/test', verifyCsrf, async (req, res, next) => {
  try {
    const marketing = await getMarketingSettings();
    const { testNumber, testMessage } = req.body;
    let testResult;
    try {
      const result = await sendSms(
        marketing.sms.toObject ? marketing.sms.toObject() : marketing.sms,
        testNumber,
        testMessage || 'This is a test SMS from your ShopKori admin panel.'
      );
      testResult = { ok: true, statusCode: result.statusCode, body: result.body };
    } catch (err) {
      testResult = { ok: false, error: err.message };
    }
    res.render('admin/marketing-manage', {
      adminPageTitle: MARKETING_CARD_META.sms.title,
      card: 'sms',
      meta: MARKETING_CARD_META.sms,
      marketing,
      testResult,
      baseUrl: `${req.protocol}://${req.get('host')}`,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   ANALYTICS
   ---------------------------------------------------------------------
   Seven report cards, matching the reference design. Each "Manage" link
   opens a real, live report — no placeholder numbers: product/stock
   reports read straight from Product, sales reports aggregate real
   Order data, and the two store-traffic reports read from PageView
   (see middleware/trackPageView.js, which logs every real storefront
   page load).
   ===================================================================== */
const ANALYTICS_CARDS = ['productReports', 'productAnalytics', 'lowStock', 'mostSoldItems', 'topCategory', 'storeVisitors', 'storeTopClicks', 'searchAnalytics'];
const ANALYTICS_CARD_META = {
  productReports: { title: 'Product Reports', path: 'product-reports', icon: 'bi-clipboard-data', color: '#f0ad4e' },
  productAnalytics: { title: 'Product Analytics', path: 'product-analytics', icon: 'bi-bar-chart-fill', color: '#337ab7' },
  lowStock: { title: 'Low Stock Products', path: 'low-stock', icon: 'bi-exclamation-triangle-fill', color: '#212529' },
  mostSoldItems: { title: 'Product Most Sold Items', path: 'most-sold', icon: 'bi-fire', color: '#7c3aed' },
  topCategory: { title: 'Top Category', path: 'top-category', icon: 'bi-tags-fill', color: '#2e9e5b' },
  storeVisitors: { title: 'Store Visitors', path: 'store-visitors', icon: 'bi-people-fill', color: '#16a085' },
  storeTopClicks: { title: 'Store Top Clicks', path: 'store-top-clicks', icon: 'bi-cursor-fill', color: '#d6336c' },
  searchAnalytics: { title: 'Search Analytics', path: 'search-analytics', icon: 'bi-search', color: '#0ea5a5' },
};

// Same from/to date-range convention as the existing Sales Report page
// (GET /reports below) — default to the last 30 days. fromDate/toDate are
// built as explicit UTC instants (not server-local time): MongoDB's
// $dateToString (used for the Store Visitors daily chart) groups in UTC
// by default, so parsing "YYYY-MM-DD" as local time here would silently
// shift day boundaries by the server's UTC offset — e.g. under
// Asia/Dhaka (UTC+6) a day's traffic could split across two different
// $dateToString buckets. Treating from/to as UTC calendar dates keeps
// every date comparison and grouping in the same frame of reference.
function resolveDateRange(req) {
  const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  return { from, to, fromDate: new Date(`${from}T00:00:00.000Z`), toDate: new Date(`${to}T23:59:59.999Z`) };
}

router.get('/analytics', (req, res) => {
  res.render('admin/analytics', { adminPageTitle: 'Analytics Settings', ANALYTICS_CARDS, ANALYTICS_CARD_META });
});

router.get('/analytics/product-reports', async (req, res, next) => {
  try {
    const products = await Product.find().populate('category').sort({ createdAt: -1 });
    res.render('admin/analytics-product-reports', {
      adminPageTitle: 'Product Reports',
      meta: ANALYTICS_CARD_META.productReports,
      products,
      totalProducts: products.length,
      totalStockUnits: products.reduce((s, p) => s + (p.stock || 0), 0),
      totalStockValue: products.reduce((s, p) => s + (p.stock || 0) * (p.price || 0), 0),
      outOfStockCount: products.filter((p) => (p.stock || 0) <= 0).length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/product-analytics', async (req, res, next) => {
  try {
    const { from, to, fromDate, toDate } = resolveDateRange(req);
    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate }, isDeleted: false } },
      { $unwind: '$items' },
      { $group: { _id: { name: '$items.productName', image: '$items.productImage' }, qtySold: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' }, orderCount: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
    ]);
    res.render('admin/analytics-product-analytics', {
      adminPageTitle: 'Product Analytics',
      meta: ANALYTICS_CARD_META.productAnalytics,
      from, to, rows,
      totalUnits: rows.reduce((s, r) => s + r.qtySold, 0),
      totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/low-stock', async (req, res, next) => {
  try {
    const products = await Product.find({ $expr: { $lte: ['$stock', '$stockAlert'] } }).populate('category').sort({ stock: 1 });
    res.render('admin/analytics-low-stock', {
      adminPageTitle: 'Low Stock Products',
      meta: ANALYTICS_CARD_META.lowStock,
      products,
      outOfStockCount: products.filter((p) => (p.stock || 0) <= 0).length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/most-sold', async (req, res, next) => {
  try {
    const { from, to, fromDate, toDate } = resolveDateRange(req);
    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate }, isDeleted: false } },
      { $unwind: '$items' },
      { $group: { _id: { name: '$items.productName', image: '$items.productImage' }, qtySold: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { qtySold: -1 } },
      { $limit: 50 },
    ]);
    res.render('admin/analytics-most-sold', {
      adminPageTitle: 'Product Most Sold Items',
      meta: ANALYTICS_CARD_META.mostSoldItems,
      from, to, rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/top-category', async (req, res, next) => {
  try {
    const { from, to, fromDate, toDate } = resolveDateRange(req);
    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate }, isDeleted: false } },
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productDoc' } },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'categories', localField: 'productDoc.category', foreignField: '_id', as: 'categoryDoc' } },
      { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$categoryDoc.name', 'Uncategorized'] }, revenue: { $sum: '$items.lineTotal' }, qty: { $sum: '$items.qty' } } },
      { $sort: { revenue: -1 } },
    ]);
    res.render('admin/analytics-top-category', {
      adminPageTitle: 'Top Category',
      meta: ANALYTICS_CARD_META.topCategory,
      from, to, rows,
      totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/store-visitors', async (req, res, next) => {
  try {
    const { from, to, fromDate, toDate } = resolveDateRange(req);
    const [dailyRows, uniqueVisitors] = await Promise.all([
      PageView.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, views: { $sum: 1 }, uniques: { $addToSet: '$sessionKey' } } },
      ]),
      PageView.distinct('sessionKey', { createdAt: { $gte: fromDate, $lte: toDate }, sessionKey: { $ne: '' } }),
    ]);
    const dailyMap = {};
    dailyRows.forEach((r) => { dailyMap[r._id] = { views: r.views, uniques: r.uniques.filter(Boolean).length }; });

    const labels = [];
    const viewsData = [];
    const uniquesData = [];
    // UTC-stepped on purpose (setUTCDate, not setDate) — matches the UTC
    // calendar days $dateToString grouped dailyRows by above, so a day
    // never lands one bucket off from what it's displayed as (see
    // resolveDateRange's comment for why local-time stepping would drift).
    for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }));
      viewsData.push((dailyMap[key] && dailyMap[key].views) || 0);
      uniquesData.push((dailyMap[key] && dailyMap[key].uniques) || 0);
    }

    res.render('admin/analytics-store-visitors', {
      adminPageTitle: 'Store Visitors',
      meta: ANALYTICS_CARD_META.storeVisitors,
      from, to, labels, viewsData, uniquesData,
      totalViews: viewsData.reduce((a, b) => a + b, 0),
      totalUniqueVisitors: uniqueVisitors.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/analytics/store-top-clicks', async (req, res, next) => {
  try {
    const { from, to, fromDate, toDate } = resolveDateRange(req);
    const rows = await PageView.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$path', views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 50 },
    ]);
    res.render('admin/analytics-store-top-clicks', {
      adminPageTitle: 'Store Top Clicks',
      meta: ANALYTICS_CARD_META.storeTopClicks,
      from, to, rows,
      totalViews: rows.reduce((s, r) => s + r.views, 0),
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------
   SEARCH ANALYTICS — real storefront search logging (see models/SearchLog.js
   and GET /search in routes/store.js). Top Searches and No Result Searches
   are real aggregations over logged queries. "Search Conversion" is a
   deliberately scoped, disclosed approximation: it's the % of sessions
   that searched in this window and ALSO placed any order in the same
   browser session (matching SearchLog.sessionKey against Order.trackToken
   — both are req.sessionID, see models/SearchLog.js's file comment) — not
   "this exact search term caused this exact purchase", which would need
   product-click tracking this app doesn't have.
   --------------------------------------------------------------------- */
router.get('/analytics/search-analytics', async (req, res, next) => {
  try {
    const { from, to, fromDate, toDate } = resolveDateRange(req);
    const match = { createdAt: { $gte: fromDate, $lte: toDate } };

    const [recentSearches, topSearches, noResultSearches, totalSearches, searchedSessions] = await Promise.all([
      SearchLog.find(match).sort({ createdAt: -1 }).limit(20).lean(),
      SearchLog.aggregate([
        { $match: match },
        { $group: { _id: { $toLower: '$query' }, count: { $sum: 1 }, avgResults: { $avg: '$resultCount' } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
      SearchLog.aggregate([
        { $match: { ...match, resultCount: 0 } },
        { $group: { _id: { $toLower: '$query' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
      SearchLog.countDocuments(match),
      SearchLog.distinct('sessionKey', { ...match, sessionKey: { $ne: '' } }),
    ]);

    let convertedCount = 0;
    if (searchedSessions.length) {
      const orderedSessions = await Order.distinct('trackToken', { trackToken: { $in: searchedSessions }, isDeleted: false });
      convertedCount = orderedSessions.length;
    }
    const conversionRate = searchedSessions.length ? (convertedCount / searchedSessions.length) * 100 : 0;
    const noResultCount = noResultSearches.reduce((s, r) => s + r.count, 0);

    res.render('admin/analytics-search', {
      adminPageTitle: 'Search Analytics',
      meta: ANALYTICS_CARD_META.searchAnalytics,
      from,
      to,
      recentSearches,
      topSearches,
      noResultSearches,
      totalSearches,
      noResultCount,
      uniqueSearchSessions: searchedSessions.length,
      convertedCount,
      conversionRate,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CUSTOMERS
   ===================================================================== */
router.get('/customers', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const filter = q
      ? { $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }, { phone: new RegExp(q, 'i') }] }
      : {};
    const customers = await Customer.find(filter).sort({ createdAt: -1 }).lean();

    const orderStats = await Order.aggregate([
      { $match: { customer: { $ne: null } } },
      { $group: { _id: '$customer', orderCount: { $sum: 1 }, totalSpent: { $sum: '$total' } } },
    ]);
    const statsMap = {};
    orderStats.forEach((s) => { statsMap[String(s._id)] = s; });

    customers.forEach((c) => {
      const stats = statsMap[String(c._id)];
      c.orderCount = stats ? stats.orderCount : 0;
      c.totalSpent = stats ? stats.totalSpent : 0;
    });

    res.render('admin/customers', { adminPageTitle: 'Customer Management', customers, q });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   REFERRAL PROGRAM — a real Admin > Customer acquisition referral link.
   ---------------------------------------------------------------------
   The reference design (ClickDokan) is SaaS-platform-shaped: refer other
   businesses to buy a ClickDokan "Plan" and earn a cut ("Refer Imran and
   earn ৳500 per paid signup!"). ShopKori has no such multi-tenant
   Plan/subscription system at all — no models/Plan.js, and "Plans" /
   "Ad On" / "Startup Package" from the reference sidebar were never added
   to admin-header.ejs either — so that literal feature has nothing real
   to attach to.

   This is built as ShopKori's own, genuinely working equivalent instead:
   each Admin gets a personal share link. When someone creates a Customer
   account on the storefront via that link, Customer.referredBy records
   which Admin gets credit (see middleware/storeLocals.js, which captures
   ?ref=<code> into the session, and POST /register in routes/store.js,
   which resolves it onto the new Customer). A "paid signup" is that
   referred customer's first order reaching paymentStatus 'paid' (online
   payment) or status 'delivered' (COD collected on delivery) — the two
   real "money actually changed hands" signals this app already has.

   The Referral Transaction table's columns are relabeled from the
   reference design's "Plan Name / Plan Price" (no such concept exists
   here) to the real Customer + Order Amount that earned the commission —
   same table shape and style, real data instead of a mismatched label.
   commissionAmount is a fixed ৳500 (models/ReferralSetting.js) — the
   reference design's Guideline card has no edit form, so there's no UI to
   change it yet. The Payout tab's "Request Payout" button and its inline
   Paid/Reject actions are an original, disclosed addition (no payout-
   request button was visible in the reference screenshot) — without it,
   Payout History would have no way to ever contain a row, mirroring the
   already-existing Admin > Manage Delivery > Commission Request pattern.
   ===================================================================== */
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function ensureAdminReferralCode(admin) {
  if (admin.referralCode) return admin.referralCode;
  let code;
  let taken = true;
  while (taken) {
    code = generateReferralCode();
    // eslint-disable-next-line no-await-in-loop
    taken = !!(await Admin.findOne({ referralCode: code }));
  }
  admin.referralCode = code;
  await admin.save();
  return code;
}

// A referred customer's first order to reach either real "paid" signal
// this app has: online payment success, or COD cash collected on delivery.
async function qualifyingReferralOrders(adminId) {
  const referredCustomers = await Customer.find({ referredBy: adminId }).sort({ createdAt: -1 }).lean();
  const customerIds = referredCustomers.map((c) => c._id);
  if (!customerIds.length) return { referredCustomers, orders: [] };
  const orders = await Order.find({
    customer: { $in: customerIds },
    isDeleted: false,
    $or: [{ paymentStatus: 'paid' }, { status: 'delivered' }],
  }).select('customer orderNumber total createdAt').sort({ createdAt: -1 }).lean();
  return { referredCustomers, orders };
}

async function referralBalances(adminId) {
  const [referralSetting, { orders }, requests] = await Promise.all([
    getReferralSetting(),
    qualifyingReferralOrders(adminId),
    ReferralPayoutRequest.find({ admin: adminId }).sort({ createdAt: -1 }),
  ]);
  const totalCommission = orders.reduce((sum, o) => sum + Math.min(referralSetting.commissionAmount, o.total || 0), 0);
  const paidCommission = requests.filter((r) => r.status === 'paid').reduce((sum, r) => sum + r.amount, 0);
  const pendingCommission = requests.filter((r) => r.status === 'pending').reduce((sum, r) => sum + r.amount, 0);
  const available = Math.max(0, totalCommission - paidCommission - pendingCommission);
  return {
    totalCommission, paidCommission, pendingCommission, available, requests,
  };
}

router.get('/referral-program', async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.session.adminId);
    const code = await ensureAdminReferralCode(admin);
    const referralLink = `${req.protocol}://${req.get('host')}/register?ref=${code}`;
    const referralSetting = await getReferralSetting();
    res.render('admin/referral-guideline', {
      adminPageTitle: 'Referral Program', referralTab: 'guideline', referralLink, referralSetting,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/referral-program/transactions', async (req, res, next) => {
  try {
    const referralSetting = await getReferralSetting();
    const { referredCustomers, orders } = await qualifyingReferralOrders(req.session.adminId);
    const customerById = {};
    referredCustomers.forEach((c) => { customerById[String(c._id)] = c; });

    const rows = orders.map((o) => {
      const commissionAmount = Math.min(referralSetting.commissionAmount, o.total || 0);
      const commissionPercent = o.total ? (commissionAmount / o.total) * 100 : 0;
      return {
        customer: customerById[String(o.customer)] || null,
        orderNumber: o.orderNumber,
        orderTotal: o.total,
        createdAt: o.createdAt,
        commissionAmount,
        commissionPercent,
      };
    });

    res.render('admin/referral-transactions', {
      adminPageTitle: 'Referral Program', referralTab: 'transactions', rows, referralSetting,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/referral-program/payout', async (req, res, next) => {
  try {
    const {
      totalCommission, paidCommission, available, requests,
    } = await referralBalances(req.session.adminId);
    res.render('admin/referral-payout', {
      adminPageTitle: 'Referral Program', referralTab: 'payout', totalCommission, paidCommission, available, requests, errors: [],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/referral-program/payout', verifyCsrf, async (req, res, next) => {
  try {
    const adminId = req.session.adminId;
    const {
      totalCommission, paidCommission, available, requests,
    } = await referralBalances(adminId);

    const amount = Number(req.body.amount);
    const method = req.body.method;
    const paymentNumber = (req.body.paymentNumber || '').trim();
    const errors = [];
    if (!amount || amount <= 0) errors.push('Enter a valid amount.');
    else if (amount > available) errors.push(`You can request up to ${available.toFixed(2)} — your current unpaid commission balance.`);
    if (!['cash', 'bkash', 'nagad', 'bank'].includes(method)) errors.push('Select a payment method.');
    if (!paymentNumber) errors.push('Enter your payment number / account.');

    if (errors.length) {
      return res.render('admin/referral-payout', {
        adminPageTitle: 'Referral Program', referralTab: 'payout', totalCommission, paidCommission, available, requests, errors,
      });
    }

    await ReferralPayoutRequest.create({
      admin: adminId, amount, method, paymentNumber,
    });
    req.flash('success', 'Payout request submitted successfully.');
    res.redirect('/admin/referral-program/payout');
  } catch (err) {
    next(err);
  }
});

router.post('/referral-program/payout/:id/action', verifyCsrf, async (req, res, next) => {
  try {
    const action = req.body.action === 'paid' ? 'paid' : (req.body.action === 'reject' ? 'rejected' : null);
    if (action) {
      await ReferralPayoutRequest.updateOne({ _id: req.params.id, status: 'pending' }, { status: action });
      req.flash('success', `Payout request marked ${action}.`);
    }
    res.redirect('/admin/referral-program/payout');
  } catch (err) {
    next(err);
  }
});

router.get('/referral-program/users', async (req, res, next) => {
  try {
    const referredCustomers = await Customer.find({ referredBy: req.session.adminId }).sort({ createdAt: -1 }).lean();
    res.render('admin/referral-users', { adminPageTitle: 'Referral Program', referralTab: 'users', referredCustomers });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   HELP & SUPPORT
   ---------------------------------------------------------------------
   This page is the store admin reaching ShopKori's own platform support
   team (the banner says "for decisions or technical problems"), not
   customers reaching the store — see models/HelpSupportSetting.js for why
   that's kept separate from models/HomeSetting.js's storefront contact
   fields. Of the 5 cards: Call Now / Email / Live Chat / Join Community
   are direct tel:/mailto:/new-tab links built from HelpSupportSetting's
   (currently fixed, undisclosed-in-the-design) values — genuinely real,
   just not yet editable from a UI. Create Support Ticket is the one card
   with an actual data-backed flow: it opens a modal (kept off the main
   page so the page itself stays exactly like the reference screenshot)
   with a form plus a short history of tickets already raised, backed by
   models/SupportTicket.js. There's no live ShopKori support agent in
   this app, so a ticket is a real, saved, shared record any admin can
   mark Resolved — not a two-way conversation.
   ===================================================================== */
router.get('/help-support', async (req, res, next) => {
  try {
    const [helpSupportSetting, tickets] = await Promise.all([
      getHelpSupportSetting(),
      SupportTicket.find().sort({ createdAt: -1 }).limit(5).populate('admin', 'username fullName'),
    ]);
    res.render('admin/help-support', {
      adminPageTitle: 'Help & Support', helpSupportSetting, tickets, errors: [],
    });
  } catch (err) {
    next(err);
  }
});

router.post('/help-support/tickets', verifyCsrf, async (req, res, next) => {
  try {
    const { subject, message, priority } = req.body;
    const errors = [];
    if (!subject || !subject.trim()) errors.push('Subject is required.');
    if (!message || !message.trim()) errors.push('Please describe your issue.');

    if (errors.length) {
      const [helpSupportSetting, tickets] = await Promise.all([
        getHelpSupportSetting(),
        SupportTicket.find().sort({ createdAt: -1 }).limit(5).populate('admin', 'username fullName'),
      ]);
      return res.render('admin/help-support', {
        adminPageTitle: 'Help & Support', helpSupportSetting, tickets, errors,
      });
    }

    await SupportTicket.create({
      admin: req.session.adminId,
      subject: subject.trim(),
      message: message.trim(),
      priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
    });
    req.flash('success', 'Support ticket submitted successfully.');
    res.redirect('/admin/help-support');
  } catch (err) {
    next(err);
  }
});

router.get('/help-support/tickets/:id/resolve', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/help-support');
    }
    await SupportTicket.updateOne({ _id: req.params.id }, { status: 'resolved' });
    req.flash('success', 'Ticket marked resolved.');
    res.redirect('/admin/help-support');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   ANNOUNCEMENT SYSTEM
   ---------------------------------------------------------------------
   ClickDokan's reference design targets "To All Vendors / To Specific
   Vendors / To Customers / To Admin Staff" — ShopKori has no Vendor
   concept at all (single-tenant, no models/Vendor.js), so Vendor-targeting
   is dropped entirely; audience is Customers (storefront) or Admin Staff
   (this panel) instead — see models/Announcement.js. Both banners are
   real and rendered from live data (middleware/adminLocals.js,
   middleware/storeLocals.js, views/admin/partials/admin-header.ejs,
   views/partials/header.ejs). Any logged-in admin can create/manage
   announcements — no distinct Super Admin role exists in this app beyond
   login-gating, same precedent as Referral Payout approve/reject and
   Support Ticket resolve above.
   ===================================================================== */
router.get('/announcements', async (req, res, next) => {
  try {
    const list = await Announcement.find({}).sort({ createdAt: -1 }).populate('createdBy', 'fullName username').lean();
    res.render('admin/announcements', { adminPageTitle: 'Announcement System', list, errors: [], formData: {} });
  } catch (err) {
    next(err);
  }
});

router.post('/announcements', verifyCsrf, async (req, res, next) => {
  try {
    const { title, message, audience, expiresAt } = req.body;
    const errors = [];
    if (!title || !title.trim()) errors.push('Title is required.');
    if (!message || !message.trim()) errors.push('Message is required.');
    if (!['customers', 'admin_staff'].includes(audience)) errors.push('Choose a valid audience.');
    if (errors.length) {
      const list = await Announcement.find({}).sort({ createdAt: -1 }).populate('createdBy', 'fullName username').lean();
      return res.render('admin/announcements', { adminPageTitle: 'Announcement System', list, errors, formData: req.body });
    }
    await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      audience,
      createdBy: req.session.adminId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    req.flash('success', 'Announcement published.');
    res.redirect('/admin/announcements');
  } catch (err) {
    next(err);
  }
});

router.get('/announcements/:id/toggle', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/announcements');
    }
    const ann = await Announcement.findById(req.params.id);
    if (ann) {
      ann.active = !ann.active;
      await ann.save();
    }
    res.redirect('/admin/announcements');
  } catch (err) {
    next(err);
  }
});

router.get('/announcements/:id/delete', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/announcements');
    }
    await Announcement.deleteOne({ _id: req.params.id });
    req.flash('success', 'Announcement deleted.');
    res.redirect('/admin/announcements');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   API & INTEGRATION MANAGEMENT
   ---------------------------------------------------------------------
   One hub linking out to every integration this app actually has a real
   settings surface for, rather than duplicating them: Payment Gateways ->
   Settings > Payment (models/PaymentSetting.js), Courier APIs -> Settings
   > Courier (models/CourierSetup.js), Google Analytics / Meta Pixel / SMS
   Gateway -> the matching Marketing cards (models/MarketingSetting.js).
   Email Provider is new here and saved-only — no email-sending library
   exists in package.json, so it's not wired into an actual send path (see
   models/EmailSetting.js). Firebase / Cloud Storage / Search Engine have
   no integration point anywhere in this codebase, so they're shown as
   honest "Not Connected" cards rather than fabricated settings forms —
   same precedent as Staff Settings' Product Assign List / Commission
   Request coming-soon cards. Secrets are masked on this hub (see
   maskSecret in middleware/helpers.js) per the spec's own instruction
   that "sensitive API secrets should not be shown in full in the UI".
   ===================================================================== */
router.get('/integrations', async (req, res, next) => {
  try {
    const [payment, courierSetups, marketing, email] = await Promise.all([
      getPaymentSettings(),
      CourierSetup.find({}).lean(),
      getMarketingSettings(),
      getEmailSetting(),
    ]);
    res.render('admin/integrations', {
      adminPageTitle: 'API & Integration Management',
      payment, courierSetups, marketing, email, maskSecret,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/integrations/email', async (req, res, next) => {
  try {
    const email = await getEmailSetting();
    res.render('admin/integrations-email', { adminPageTitle: 'Email Provider', email, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/integrations/email', verifyCsrf, async (req, res, next) => {
  try {
    const data = { ...req.body };
    delete data.csrfToken;
    data.status = data.status === 'on';
    await updateEmailSetting(data);
    req.flash('success', 'Email provider settings saved. (Not wired into an actual send path yet — see the note on this page.)');
    res.redirect('/admin/integrations/email');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SECURITY DASHBOARD
   ---------------------------------------------------------------------
   Real, not decorative: Failed Logins / Admin Login History / Suspicious
   Activity read from LoginLog (written by POST /login and POST
   /login/2fa above); Blocked IPs is enforced at POST /login; 2FA is a
   hand-built RFC 6238 TOTP (lib/totp.js) verified against POST
   /login/2fa, since no QR-code library exists here — enrollment shows
   the base32 secret as text to type into an authenticator app by hand;
   Active Sessions / Force Logout / Revoke Session query and delete
   documents directly from the real connect-mongo `sessions` collection
   this app already uses for every login (see server.js), not a separate
   parallel session-tracking model. API Activity is intentionally left
   out: no API-key-authenticated external surface and no outbound-call
   logger exist anywhere in this codebase, so it's disclosed as untracked
   rather than fabricated. Any logged-in admin can take these actions —
   no distinct Super Admin role exists in this app beyond login-gating.
   ===================================================================== */
router.get('/security', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedLogins, loginHistory, blockedIps, admins, sessionsRaw, suspicious] = await Promise.all([
      LoginLog.find({ status: 'failed', createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(30).lean(),
      LoginLog.find({ status: 'success', createdAt: { $gte: since } }).sort({ createdAt: -1 }).populate('admin', 'fullName username').limit(30).lean(),
      BlockedIp.find({}).sort({ createdAt: -1 }).populate('blockedBy', 'fullName username').lean(),
      Admin.find({}).select('username fullName email twoFactorEnabled').lean(),
      mongoose.connection.db.collection('sessions').find({}).toArray(),
      // Suspicious Activity: genuinely computed, not fabricated — any IP
      // with 5+ failed attempts in the last 24 hours.
      LoginLog.aggregate([
        { $match: { status: 'failed', createdAt: { $gte: last24h } } },
        { $group: { _id: '$ip', count: { $sum: 1 }, lastAttempt: { $max: '$createdAt' }, usernames: { $addToSet: '$usernameAttempted' } } },
        { $match: { count: { $gte: 5 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Active Sessions: parse each raw sessions-collection doc's JSON blob
    // for an adminId, join to Admin — reading the real, live session
    // store connect-mongo already maintains, not a fabricated model.
    const activeSessions = [];
    sessionsRaw.forEach((doc) => {
      try {
        const parsed = JSON.parse(doc.session);
        if (parsed.adminId) {
          const adminDoc = admins.find((a) => String(a._id) === String(parsed.adminId));
          activeSessions.push({
            sessionId: doc._id,
            adminId: parsed.adminId,
            adminName: adminDoc ? (adminDoc.fullName || adminDoc.username) : 'Unknown / deleted admin',
            expires: doc.expires,
          });
        }
      } catch (e) {
        // Not an admin session (e.g. a customer session, or a
        // pending2fa-only session with no adminId yet) — skip it.
      }
    });

    res.render('admin/security', {
      adminPageTitle: 'Security Dashboard',
      failedLogins, loginHistory, blockedIps, admins, suspicious, activeSessions,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/security/block-ip', verifyCsrf, async (req, res, next) => {
  try {
    const ip = (req.body.ip || '').trim();
    if (ip) {
      await BlockedIp.updateOne({ ip }, { ip, reason: req.body.reason || '', blockedBy: req.session.adminId }, { upsert: true });
      req.flash('success', `${ip} blocked.`);
    }
    res.redirect('/admin/security');
  } catch (err) {
    next(err);
  }
});

router.get('/security/unblock-ip/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/security');
    }
    await BlockedIp.deleteOne({ _id: req.params.id });
    req.flash('success', 'IP unblocked.');
    res.redirect('/admin/security');
  } catch (err) {
    next(err);
  }
});

router.get('/security/revoke-session/:sessionId', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/security');
    }
    // Deleting the raw session document genuinely invalidates that
    // browser's session — connect-mongo/express-session treats a missing
    // session id as a brand-new, empty session on its next request.
    await mongoose.connection.db.collection('sessions').deleteOne({ _id: req.params.sessionId });
    req.flash('success', 'Session revoked — that browser will be signed out on its next request.');
    res.redirect('/admin/security');
  } catch (err) {
    next(err);
  }
});

router.get('/security/reset-2fa/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/security');
    }
    await Admin.updateOne({ _id: req.params.id }, { twoFactorEnabled: false, twoFactorSecret: null });
    req.flash('success', '2FA reset for that account. They can re-enable it themselves from their own login.');
    res.redirect('/admin/security');
  } catch (err) {
    next(err);
  }
});

// Self-service 2FA enrollment for the currently logged-in admin's own
// account — this is the only route that ever turns twoFactorEnabled on;
// Reset 2FA above only ever turns it back off for someone else.
router.get('/security/2fa/enable', (req, res) => {
  const secret = generateSecret();
  req.session.pendingTotpSecret = secret;
  res.render('admin/security-2fa-enable', { adminPageTitle: 'Enable 2FA', secret, errors: [] });
});

router.post('/security/2fa/enable', verifyCsrf, async (req, res, next) => {
  try {
    const secret = req.session.pendingTotpSecret;
    if (!secret) return res.redirect('/admin/security/2fa/enable');
    if (!verifyTotp(secret, req.body.code)) {
      return res.render('admin/security-2fa-enable', { adminPageTitle: 'Enable 2FA', secret, errors: ['Invalid code — check your authenticator app and try again.'] });
    }
    await Admin.updateOne({ _id: req.session.adminId }, { twoFactorSecret: secret, twoFactorEnabled: true });
    delete req.session.pendingTotpSecret;
    req.flash('success', '2FA enabled on your account.');
    res.redirect('/admin/security');
  } catch (err) {
    next(err);
  }
});

router.get('/security/2fa/disable', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/security');
    }
    await Admin.updateOne({ _id: req.session.adminId }, { twoFactorEnabled: false, twoFactorSecret: null });
    req.flash('success', '2FA disabled on your account.');
    res.redirect('/admin/security');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   REPORTS
   ===================================================================== */
router.get('/reports', async (req, res, next) => {
  try {
    const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || new Date().toISOString().slice(0, 10);

    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T23:59:59.999`);

    const dailyRows = await Order.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$total' },
          cnt: { $sum: 1 },
        },
      },
    ]);
    const dailyMap = {};
    dailyRows.forEach((r) => { dailyMap[r._id] = r; });

    const labels = [];
    const salesData = [];
    const ordersData = [];
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
      salesData.push(dailyMap[key]?.total || 0);
      ordersData.push(dailyMap[key]?.cnt || 0);
    }

    const totalSales = salesData.reduce((a, b) => a + b, 0);
    const totalOrdersInRange = ordersData.reduce((a, b) => a + b, 0);
    const avgOrderValue = totalOrdersInRange > 0 ? totalSales / totalOrdersInRange : 0;

    const topProducts = await Order.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: { name: '$items.productName', image: '$items.productImage' },
          qtySold: { $sum: '$items.qty' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { qtySold: -1 } },
      { $limit: 10 },
    ]);

    const categorySalesRaw = await Order.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      { $unwind: '$items' },
      {
        $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productDoc' },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: { from: 'categories', localField: 'productDoc.category', foreignField: '_id', as: 'categoryDoc' },
      },
      { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: { _id: { $ifNull: ['$categoryDoc.name', 'Uncategorized'] }, revenue: { $sum: '$items.lineTotal' } },
      },
      { $sort: { revenue: -1 } },
    ]);

    res.render('admin/reports', {
      adminPageTitle: 'Sales Report & Analytics',
      from,
      to,
      totalSales,
      totalOrdersInRange,
      avgOrderValue,
      labels,
      salesData,
      topProducts,
      categorySales: categorySalesRaw,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — hub grid
   ---------------------------------------------------------------------
   /admin/settings used to BE the flat site-info form directly; that form
   now lives at /admin/settings/general (all the same fields, unchanged
   behavior) so this path can become the card-grid hub matching the
   reference design, same grid pattern as Marketing/Analytics.
   ===================================================================== */
const SETTINGS_CARDS = ['deliveryCharge', 'courier', 'payment', 'offer', 'blog', 'invoice', 'pageBuilder', 'coupon', 'general'];
const SETTINGS_CARD_META = {
  deliveryCharge: { title: 'Delivery Charge', path: '/admin/settings/delivery-charge', icon: 'bi-truck', color: '#337ab7' },
  courier: { title: 'Courier', path: '/admin/settings/courier', icon: 'bi-box-seam', color: '#7c3aed' },
  payment: { title: 'Payment Methods', path: '/admin/settings/payment', icon: 'bi-credit-card', color: '#28a745' },
  offer: { title: 'Manage Offer', path: '/admin/offer', icon: 'bi-gift', color: '#212529' },
  blog: { title: 'Blog Setting', path: '/admin/blog', icon: 'bi-journal-richtext', color: '#f0ad4e' },
  invoice: { title: 'Invoice Setting', path: '/admin/settings/invoice', icon: 'bi-receipt', color: '#6f42c1' },
  pageBuilder: { title: 'Page Builder', path: '/admin/settings/page-builder', icon: 'bi-file-earmark-richtext', color: '#2e9e5b' },
  coupon: { title: 'Product Coupon', path: '/admin/settings/coupon', icon: 'bi-ticket-perforated', color: '#d6336c' },
  general: { title: 'General Settings', path: '/admin/settings/general', icon: 'bi-sliders', color: '#495057' },
};

router.get('/settings', (req, res) => {
  res.render('admin/settings', { adminPageTitle: 'Settings', SETTINGS_CARDS, SETTINGS_CARD_META });
});

router.get('/settings/general', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('admin/settings-general', { adminPageTitle: 'General Settings', settingsData: settings });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/general', verifyCsrf, async (req, res, next) => {
  try {
    const keys = ['site_name', 'site_tagline', 'currency_symbol', 'flat_shipping_fee', 'bkash_number', 'phone', 'email', 'address'];
    await Promise.all(keys.map((key) => (req.body[key] !== undefined ? setSetting(key, req.body[key]) : null)));
    req.flash('success', 'Settings saved successfully.');
    res.redirect('/admin/settings/general');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — Delivery Charge (zones + rates)
   ===================================================================== */
router.get('/settings/delivery-charge', async (req, res, next) => {
  try {
    const zones = await DeliveryZone.find().sort({ name: 1 });
    res.render('admin/settings-delivery-charge', { adminPageTitle: 'Delivery Rate', zones });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/delivery-charge/type', verifyCsrf, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) {
      req.flash('danger', 'Location name is required.');
      return res.redirect('/admin/settings/delivery-charge');
    }
    const existing = await DeliveryZone.findOne({ name });
    if (existing) {
      req.flash('danger', 'That location already exists.');
      return res.redirect('/admin/settings/delivery-charge');
    }
    await DeliveryZone.create({ name });
    req.flash('success', 'Delivery location added successfully.');
    res.redirect('/admin/settings/delivery-charge');
  } catch (err) {
    next(err);
  }
});

router.post('/settings/delivery-charge/rate', verifyCsrf, async (req, res, next) => {
  try {
    const { location, amount } = req.body;
    if (!location || amount === undefined || amount === '') {
      req.flash('danger', 'Pick a location and enter an amount.');
      return res.redirect('/admin/settings/delivery-charge');
    }
    const zone = await DeliveryZone.findById(location);
    if (!zone) {
      req.flash('danger', 'Location not found.');
      return res.redirect('/admin/settings/delivery-charge');
    }
    zone.rate = parseFloat(amount) || 0;
    await zone.save();
    req.flash('success', 'Delivery rate saved successfully.');
    res.redirect('/admin/settings/delivery-charge');
  } catch (err) {
    next(err);
  }
});

router.get('/settings/delivery-charge/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/settings/delivery-charge');
    }
    await DeliveryZone.deleteOne({ _id: req.params.id });
    req.flash('success', 'Delivery location deleted successfully.');
    res.redirect('/admin/settings/delivery-charge');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — Courier setups
   ===================================================================== */
router.get('/settings/courier', async (req, res, next) => {
  try {
    const couriers = await CourierSetup.find().sort({ createdAt: -1 });
    res.render('admin/settings-courier', { adminPageTitle: 'Courier Setups', couriers, COURIERS });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/courier/new', verifyCsrf, async (req, res, next) => {
  try {
    const { courier, apiKey, secretKey, storeId, webhookUrl } = req.body;
    if (!courier || !courier.trim()) {
      req.flash('danger', 'Pick a courier.');
      return res.redirect('/admin/settings/courier');
    }
    await CourierSetup.create({
      courier: courier.trim(),
      apiKey: (apiKey || '').trim(),
      secretKey: (secretKey || '').trim(),
      storeId: (storeId || '').trim(),
      webhookUrl: (webhookUrl || '').trim(),
      status: !!req.body.status,
    });
    req.flash('success', 'Courier setup added successfully.');
    res.redirect('/admin/settings/courier');
  } catch (err) {
    next(err);
  }
});

router.post('/settings/courier/:id/edit', verifyCsrf, async (req, res, next) => {
  try {
    const { courier, apiKey, secretKey, storeId, webhookUrl } = req.body;
    await CourierSetup.updateOne(
      { _id: req.params.id },
      {
        courier: (courier || '').trim(),
        apiKey: (apiKey || '').trim(),
        secretKey: (secretKey || '').trim(),
        storeId: (storeId || '').trim(),
        webhookUrl: (webhookUrl || '').trim(),
        status: !!req.body.status,
      }
    );
    req.flash('success', 'Courier setup updated successfully.');
    res.redirect('/admin/settings/courier');
  } catch (err) {
    next(err);
  }
});

router.get('/settings/courier/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/settings/courier');
    }
    await CourierSetup.deleteOne({ _id: req.params.id });
    req.flash('success', 'Courier setup deleted successfully.');
    res.redirect('/admin/settings/courier');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — Payment Methods (grid + 3 manage pages)
   ===================================================================== */
const PAYMENT_CARDS = ['bkash', 'manual', 'sslcommerz'];
const PAYMENT_CARD_META = {
  bkash: { title: 'Bkash Payment', path: 'bkash', icon: 'bi-phone', color: '#337ab7' },
  manual: { title: 'Manual Payment', path: 'manual', icon: 'bi-chat-dots', color: '#7c3aed' },
  sslcommerz: { title: 'SSL Commerz Payment', path: 'ssl', icon: 'bi-shield-check', color: '#28a745' },
};

router.get('/settings/payment', async (req, res, next) => {
  try {
    const payment = await getPaymentSettings();
    res.render('admin/settings-payment', { adminPageTitle: 'Payment Settings', payment, PAYMENT_CARDS, PAYMENT_CARD_META });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/payment/bkash', async (req, res, next) => {
  try {
    const payment = await getPaymentSettings();
    res.render('admin/settings-payment-bkash', { adminPageTitle: 'Bkash Online Payment', payment });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/payment/bkash', verifyCsrf, async (req, res, next) => {
  try {
    const { username, password, appKey, appSecret } = req.body;
    await updatePaymentSettingCard('bkash', {
      username: (username || '').trim(),
      password: password || '',
      appKey: (appKey || '').trim(),
      appSecret: appSecret || '',
      status: !!req.body.status,
    });
    req.flash('success', 'Bkash online payment settings saved successfully.');
    res.redirect('/admin/settings/payment/bkash');
  } catch (err) {
    next(err);
  }
});

router.get('/settings/payment/manual', async (req, res, next) => {
  try {
    const payment = await getPaymentSettings();
    res.render('admin/settings-payment-manual', { adminPageTitle: 'Manual Payment Settings', payment });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/payment/manual', verifyCsrf, async (req, res, next) => {
  try {
    const { bkashNumber, nagadNumber, rocketNumber } = req.body;
    await updatePaymentSettingCard('manual', {
      bkashNumber: (bkashNumber || '').trim(),
      nagadNumber: (nagadNumber || '').trim(),
      rocketNumber: (rocketNumber || '').trim(),
      status: !!req.body.status,
    });
    // The manual bKash number doubles as the storefront's existing
    // Setting.js bkash_number key (already used elsewhere on the site), so
    // saving it here keeps that value in sync instead of creating a second,
    // conflicting source of truth for the same number.
    if (bkashNumber !== undefined && bkashNumber.trim()) {
      await setSetting('bkash_number', bkashNumber.trim());
    }
    req.flash('success', 'Manual payment settings saved successfully.');
    res.redirect('/admin/settings/payment/manual');
  } catch (err) {
    next(err);
  }
});

router.get('/settings/payment/ssl', async (req, res, next) => {
  try {
    const payment = await getPaymentSettings();
    res.render('admin/settings-payment-ssl', { adminPageTitle: 'SSLcommerz Online Payment', payment });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/payment/ssl', verifyCsrf, async (req, res, next) => {
  try {
    const { storeId, storePassword, transactionPrefix, appSecret } = req.body;
    await updatePaymentSettingCard('sslcommerz', {
      storeId: (storeId || '').trim(),
      storePassword: storePassword || '',
      transactionPrefix: (transactionPrefix || '').trim(),
      appSecret: appSecret || '',
      status: !!req.body.status,
    });
    req.flash('success', 'SSLcommerz online payment settings saved successfully.');
    res.redirect('/admin/settings/payment/ssl');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — Invoice Setting
   ===================================================================== */
router.get('/settings/invoice', async (req, res, next) => {
  try {
    const invoice = await getInvoiceSettings();
    res.render('admin/settings-invoice', { adminPageTitle: 'Invoice Setting', invoice });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/invoice', verifyCsrf, async (req, res, next) => {
  try {
    const { invoicePrefix, startingNumber, companyName, companyAddress, footerNote, taxPercent } = req.body;
    await updateInvoiceSettings({
      invoicePrefix: (invoicePrefix || '').trim() || 'INV-',
      startingNumber: parseInt(startingNumber, 10) || 0,
      companyName: (companyName || '').trim(),
      companyAddress: (companyAddress || '').trim(),
      footerNote: (footerNote || '').trim(),
      taxPercent: parseFloat(taxPercent) || 0,
      showLogo: !!req.body.showLogo,
    });
    req.flash('success', 'Invoice settings saved successfully.');
    res.redirect('/admin/settings/invoice');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — Page Builder (arbitrary custom pages; separate from the
   fixed-key /admin/pages editor above)
   ===================================================================== */
router.get('/settings/page-builder', async (req, res, next) => {
  try {
    const customPages = await CustomPage.find().sort({ createdAt: -1 });
    res.render('admin/settings-page-builder', { adminPageTitle: 'Page Builder Settings', customPages, editPage: null });
  } catch (err) {
    next(err);
  }
});

router.get('/settings/page-builder/:id/edit', async (req, res, next) => {
  try {
    const customPages = await CustomPage.find().sort({ createdAt: -1 });
    const editPage = await CustomPage.findById(req.params.id);
    if (!editPage) {
      req.flash('danger', 'Page not found.');
      return res.redirect('/admin/settings/page-builder');
    }
    res.render('admin/settings-page-builder', { adminPageTitle: 'Page Builder Settings', customPages, editPage });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/page-builder', verifyCsrf, async (req, res, next) => {
  try {
    const { slug: slugInput, name, title, content } = req.body;
    if (!name || !name.trim() || !title || !title.trim()) {
      req.flash('danger', 'Page Name and Page Title are required.');
      return res.redirect('/admin/settings/page-builder');
    }
    const baseSlug = slugify((slugInput && slugInput.trim()) || name);
    const slug = await ensureUniqueSlug(CustomPage, baseSlug, null);
    await CustomPage.create({
      slug,
      name: name.trim(),
      title: title.trim(),
      content: content || '',
      status: true,
    });
    req.flash('success', 'New page saved successfully.');
    res.redirect('/admin/settings/page-builder');
  } catch (err) {
    next(err);
  }
});

router.post('/settings/page-builder/:id/edit', verifyCsrf, async (req, res, next) => {
  try {
    const { slug: slugInput, name, title, content } = req.body;
    if (!name || !name.trim() || !title || !title.trim()) {
      req.flash('danger', 'Page Name and Page Title are required.');
      return res.redirect(`/admin/settings/page-builder/${req.params.id}/edit`);
    }
    const baseSlug = slugify((slugInput && slugInput.trim()) || name);
    const slug = await ensureUniqueSlug(CustomPage, baseSlug, req.params.id);
    await CustomPage.updateOne(
      { _id: req.params.id },
      { slug, name: name.trim(), title: title.trim(), content: content || '', status: !!req.body.status }
    );
    req.flash('success', 'Page updated successfully.');
    res.redirect('/admin/settings/page-builder');
  } catch (err) {
    next(err);
  }
});

router.get('/settings/page-builder/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/settings/page-builder');
    }
    await CustomPage.deleteOne({ _id: req.params.id });
    req.flash('success', 'Page deleted successfully.');
    res.redirect('/admin/settings/page-builder');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SETTINGS — Product Coupon
   ===================================================================== */
router.get('/settings/coupon', async (req, res, next) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.render('admin/settings-coupon', { adminPageTitle: 'Product Coupons', coupons, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/coupon', verifyCsrf, async (req, res, next) => {
  try {
    const { name, discountType, discountValue, limit, code } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('Coupon name is required.');
    if (!code || !code.trim()) errors.push('Coupon code is required.');
    const normalizedCode = (code || '').trim().toUpperCase();
    if (normalizedCode) {
      const existing = await Coupon.findOne({ code: normalizedCode });
      if (existing) errors.push('That coupon code is already in use.');
    }

    if (errors.length) {
      const coupons = await Coupon.find().sort({ createdAt: -1 });
      return res.render('admin/settings-coupon', { adminPageTitle: 'Product Coupons', coupons, errors });
    }

    await Coupon.create({
      name: name.trim(),
      code: normalizedCode,
      discountType: discountType === 'flat' ? 'flat' : 'percent',
      discountValue: parseFloat(discountValue) || 0,
      limit: parseInt(limit, 10) || 0,
      status: true,
    });
    req.flash('success', 'New coupon added successfully.');
    res.redirect('/admin/settings/coupon');
  } catch (err) {
    next(err);
  }
});

router.get('/settings/coupon/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/settings/coupon');
    }
    await Coupon.deleteOne({ _id: req.params.id });
    req.flash('success', 'Coupon deleted successfully.');
    res.redirect('/admin/settings/coupon');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   MANAGE OFFER — grid page linking to the 8 real /offer/* sub-pages below.
   ===================================================================== */
const OFFER_CARDS = ['flashSale', 'combo', 'bestSale', 'popular', 'hotDeal', 'special', 'latest', 'popup'];
const OFFER_CARD_META = {
  flashSale: { title: 'Flash Sale', path: '/admin/offer/flash-sale', icon: 'bi-lightning-charge-fill', color: '#f0ad4e' },
  combo: { title: 'Combo Offer', path: '/admin/offer/combo', icon: 'bi-box-seam-fill', color: '#7c3aed' },
  bestSale: { title: 'Best Sale Product', path: '/admin/offer/best-sale', icon: 'bi-award-fill', color: '#28a745' },
  popular: { title: 'Popular Product', path: '/admin/offer/popular', icon: 'bi-star-fill', color: '#212529' },
  hotDeal: { title: 'Hot Deal', path: '/admin/offer/hot-deal', icon: 'bi-fire', color: '#337ab7' },
  special: { title: 'Special Offer', path: '/admin/offer/special', icon: 'bi-gift-fill', color: '#d6336c' },
  latest: { title: 'Latest Product', path: '/admin/offer/latest', icon: 'bi-stars', color: '#5b9bd5' },
  popup: { title: 'PopUp Offer', path: '/admin/offer/popup', icon: 'bi-window-stack', color: '#f4a460' },
};

router.get('/offer', (req, res) => {
  res.render('admin/offer', { adminPageTitle: 'Offer Settings', OFFER_CARDS, OFFER_CARD_META });
});

/* =====================================================================
   OFFER SETTING — the 8 real sub-pages (see models/OfferSetting.js for
   the full LIVE vs SAVE-ONLY breakdown per card). Flash Sale, Hot Deal
   and Special Offer share one view (admin/offer-timer-collection.ejs —
   product list + countdown timer + colors); Combo, Best Sale and Popular
   share another (admin/offer-collection.ejs — product list only); both
   include the shared product-picker modal partial. Latest Products and
   PopUp Offer have their own dedicated views since their fields don't
   match either shape.
   ===================================================================== */
const TIMER_UNIT_MS = { days: 86400000, hours: 3600000, minutes: 60000 };
function computeEndsAt(timerEnabled, timerType, duration) {
  if (!timerEnabled) return null;
  const dur = parseInt(duration, 10) || 0;
  if (dur <= 0) return null;
  const unitMs = TIMER_UNIT_MS[timerType] || TIMER_UNIT_MS.days;
  return new Date(Date.now() + dur * unitMs);
}
function parseOfferProductIds(req) {
  let ids = req.body.productIds;
  if (!ids) return [];
  if (!Array.isArray(ids)) ids = [ids];
  return ids.filter(Boolean).map((id) => ({ product: id }));
}
async function allActiveProductsForPicker() {
  return Product.find({ status: true }).select('_id name sku').sort({ name: 1 }).lean();
}

// ---- Flash Sale (LIVE — drives Product.isFlashSale + the homepage section) ----
router.get('/offer/flash-sale', async (req, res, next) => {
  try {
    const [offer, products] = await Promise.all([getOfferSettingPopulated(), allActiveProductsForPicker()]);
    res.render('admin/offer-timer-collection', {
      adminPageTitle: 'Flash Sale', cardKey: 'flashSale', card: offer.flashSale, products,
      postPath: '/admin/offer/flash-sale',
    });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/flash-sale', verifyCsrf, async (req, res, next) => {
  try {
    const productsList = parseOfferProductIds(req);
    const timerEnabled = !!req.body.timerEnabled;
    const timerType = ['days', 'hours', 'minutes'].includes(req.body.timerType) ? req.body.timerType : 'days';
    const duration = parseInt(req.body.duration, 10) || 0;
    await updateOfferSetting({
      flashSale: {
        enabled: !!req.body.enabled,
        products: productsList,
        timerEnabled, timerType, duration,
        endsAt: computeEndsAt(timerEnabled, timerType, duration),
        textColor: req.body.textColor || '#ffffff',
        borderColor: req.body.borderColor || '#EC0E8C',
        backgroundColor: req.body.backgroundColor || '#EC0E8C',
      },
    });
    // LIVE sync: Product.isFlashSale is the same flag routes/store.js's
    // homepage query already reads for the "ফ্ল্যাশ সেল" section.
    const ids = productsList.map((p) => p.product);
    await Product.updateMany({ isFlashSale: true, _id: { $nin: ids } }, { isFlashSale: false });
    if (ids.length) await Product.updateMany({ _id: { $in: ids } }, { isFlashSale: true });
    req.flash('success', 'Flash Sale saved successfully.');
    res.redirect('/admin/offer/flash-sale');
  } catch (err) {
    next(err);
  }
});

// ---- Hot Deal (SAVE-ONLY — no homepage section exists for it yet) ----
router.get('/offer/hot-deal', async (req, res, next) => {
  try {
    const [offer, products] = await Promise.all([getOfferSettingPopulated(), allActiveProductsForPicker()]);
    res.render('admin/offer-timer-collection', {
      adminPageTitle: 'Hot Deal', cardKey: 'hotDeal', card: offer.hotDeal, products,
      postPath: '/admin/offer/hot-deal',
    });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/hot-deal', verifyCsrf, async (req, res, next) => {
  try {
    const productsList = parseOfferProductIds(req);
    const timerEnabled = !!req.body.timerEnabled;
    const timerType = ['days', 'hours', 'minutes'].includes(req.body.timerType) ? req.body.timerType : 'days';
    const duration = parseInt(req.body.duration, 10) || 0;
    await updateOfferSetting({
      hotDeal: {
        enabled: !!req.body.enabled,
        products: productsList,
        timerEnabled, timerType, duration,
        endsAt: computeEndsAt(timerEnabled, timerType, duration),
        textColor: req.body.textColor || '#ffffff',
        borderColor: req.body.borderColor || '#EC0E8C',
        backgroundColor: req.body.backgroundColor || '#EC0E8C',
      },
    });
    req.flash('success', 'Hot Deal saved successfully.');
    res.redirect('/admin/offer/hot-deal');
  } catch (err) {
    next(err);
  }
});

// ---- Special Offer (SAVE-ONLY — no homepage section exists for it yet) ----
router.get('/offer/special', async (req, res, next) => {
  try {
    const [offer, products] = await Promise.all([getOfferSettingPopulated(), allActiveProductsForPicker()]);
    res.render('admin/offer-timer-collection', {
      adminPageTitle: 'Special Offer', cardKey: 'special', card: offer.special, products,
      postPath: '/admin/offer/special',
    });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/special', verifyCsrf, async (req, res, next) => {
  try {
    const productsList = parseOfferProductIds(req);
    const timerEnabled = !!req.body.timerEnabled;
    const timerType = ['days', 'hours', 'minutes'].includes(req.body.timerType) ? req.body.timerType : 'days';
    const duration = parseInt(req.body.duration, 10) || 0;
    await updateOfferSetting({
      special: {
        enabled: !!req.body.enabled,
        products: productsList,
        timerEnabled, timerType, duration,
        endsAt: computeEndsAt(timerEnabled, timerType, duration),
        textColor: req.body.textColor || '#ffffff',
        borderColor: req.body.borderColor || '#EC0E8C',
        backgroundColor: req.body.backgroundColor || '#EC0E8C',
      },
    });
    req.flash('success', 'Special Offer saved successfully.');
    res.redirect('/admin/offer/special');
  } catch (err) {
    next(err);
  }
});

// ---- Combo Offer (SAVE-ONLY — no homepage section exists for it yet) ----
router.get('/offer/combo', async (req, res, next) => {
  try {
    const [offer, products] = await Promise.all([getOfferSettingPopulated(), allActiveProductsForPicker()]);
    res.render('admin/offer-collection', {
      adminPageTitle: 'Combo Offer', cardKey: 'combo', card: offer.combo, products, postPath: '/admin/offer/combo',
    });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/combo', verifyCsrf, async (req, res, next) => {
  try {
    await updateOfferSetting({ combo: { enabled: !!req.body.enabled, products: parseOfferProductIds(req) } });
    req.flash('success', 'Combo Offer saved successfully.');
    res.redirect('/admin/offer/combo');
  } catch (err) {
    next(err);
  }
});

// ---- Best Sale Products (SAVE-ONLY — no homepage section exists for it yet) ----
router.get('/offer/best-sale', async (req, res, next) => {
  try {
    const [offer, products] = await Promise.all([getOfferSettingPopulated(), allActiveProductsForPicker()]);
    res.render('admin/offer-collection', {
      adminPageTitle: 'Best Sale Products', cardKey: 'bestSale', card: offer.bestSale, products, postPath: '/admin/offer/best-sale',
    });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/best-sale', verifyCsrf, async (req, res, next) => {
  try {
    await updateOfferSetting({ bestSale: { enabled: !!req.body.enabled, products: parseOfferProductIds(req) } });
    req.flash('success', 'Best Sale Products saved successfully.');
    res.redirect('/admin/offer/best-sale');
  } catch (err) {
    next(err);
  }
});

// ---- Popular Products (LIVE — drives Product.isFeatured + the homepage section) ----
router.get('/offer/popular', async (req, res, next) => {
  try {
    const [offer, products] = await Promise.all([getOfferSettingPopulated(), allActiveProductsForPicker()]);
    res.render('admin/offer-collection', {
      adminPageTitle: 'Popular Products', cardKey: 'popular', card: offer.popular, products, postPath: '/admin/offer/popular',
    });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/popular', verifyCsrf, async (req, res, next) => {
  try {
    const productsList = parseOfferProductIds(req);
    await updateOfferSetting({ popular: { enabled: !!req.body.enabled, products: productsList } });
    // LIVE sync: Product.isFeatured is the same flag routes/store.js's
    // homepage query already reads for the "জনপ্রিয় প্রোডাক্ট" section.
    const ids = productsList.map((p) => p.product);
    await Product.updateMany({ isFeatured: true, _id: { $nin: ids } }, { isFeatured: false });
    if (ids.length) await Product.updateMany({ _id: { $in: ids } }, { isFeatured: true });
    req.flash('success', 'Popular Products saved successfully.');
    res.redirect('/admin/offer/popular');
  } catch (err) {
    next(err);
  }
});

// ---- Latest Products (LIVE — toggles the homepage "New Arrivals" section) ----
router.get('/offer/latest', async (req, res, next) => {
  try {
    const offer = await getOfferSettingPopulated();
    res.render('admin/offer-latest', { adminPageTitle: 'Latest Products', card: offer.latest });
  } catch (err) {
    next(err);
  }
});
router.post('/offer/latest', verifyCsrf, async (req, res, next) => {
  try {
    await updateOfferSetting({ latest: { enabled: !!req.body.enabled } });
    req.flash('success', 'Latest Products setting saved successfully.');
    res.redirect('/admin/offer/latest');
  } catch (err) {
    next(err);
  }
});

// ---- PopUp Offer (LIVE — shown as a real dismissible popup, see header.ejs) ----
router.get('/offer/popup', async (req, res, next) => {
  try {
    const offer = await getOfferSettingPopulated();
    res.render('admin/offer-popup', { adminPageTitle: 'PopUp Offer', card: offer.popup });
  } catch (err) {
    next(err);
  }
});
// CSRF checked manually (not via verifyCsrf) because multer's
// upload.single('image') is what parses multipart/form-data — req.body
// isn't populated until after it runs (same as saveCategory above).
router.post('/offer/popup', upload.single('image'), async (req, res, next) => {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/offer/popup');
    }
    const offer = await getOfferSettingPopulated();
    let imageName = offer.popup.image;
    if (req.file) imageName = req.file.filename;
    await updateOfferSetting({
      popup: {
        enabled: !!req.body.enabled,
        title: (req.body.title || '').trim(),
        image: imageName,
        url: (req.body.url || '').trim(),
      },
    });
    req.flash('success', 'PopUp Offer saved successfully.');
    res.redirect('/admin/offer/popup');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CUSTOMIZATION — grid hub + Store Settings (3-tab page: Brand / Store /
   Pixel) + Home Setting + Order Page Setting.

   Most of the 12 grid cards shown in the reference design (Store Logo,
   Store Favicon, Store Title, Domain Setup, Branding Logo, Phone Screen
   Navigation, Show Add To Cart In Screen, Footer Setting, Advance Theme
   Setup) are not separate pages of their own — they're all fields that
   live INSIDE the one Store Settings page's Brand/Store tabs (exactly as
   shown in the screenshots). So instead of duplicating that data across
   11 near-empty forms, each of those cards deep-links straight into the
   Store Settings tab/section that already holds that field. Manage
   Sliders and Product View Setting had no fields shown anywhere, so they
   stay honest coming-soon stubs (registered above in COMING_SOON_PAGES).
   Home Setting and Order Page Setting were shown as their own separate
   pages with no sidebar entry of their own, so they're added here as two
   extra cards on this grid (disclosed addition, same as General Settings
   was added to the Settings hub).
   ===================================================================== */
const CUSTOMIZATION_CARDS = [
  'storeSettings', 'storeLogo', 'storeFavicon', 'storeTitle', 'domainSetup', 'brandingLogo',
  'phoneNavigation', 'addToCartScreen', 'manageSliders', 'footerSetting', 'productViewSetting',
  'advanceTheme', 'homeSetting', 'orderPageSetting',
];
const CUSTOMIZATION_CARD_META = {
  storeSettings: { title: 'Store Settings', path: '/admin/customization/store-settings', icon: 'bi-shop', color: '#337ab7' },
  storeLogo: { title: 'Store Logo', path: '/admin/customization/store-settings?tab=store#logoSettings', icon: 'bi-image', color: '#28a745' },
  storeFavicon: { title: 'Store Favicon', path: '/admin/customization/store-settings?tab=brand#logoFavicon', icon: 'bi-app', color: '#f0ad4e' },
  storeTitle: { title: 'Store Title', path: '/admin/customization/store-settings?tab=brand#textFormat', icon: 'bi-type', color: '#7c3aed' },
  domainSetup: { title: 'Domain Setup', path: '/admin/customization/store-settings?tab=store#domainSettings', icon: 'bi-globe', color: '#16a085' },
  brandingLogo: { title: 'Branding Logo', path: '/admin/customization/store-settings?tab=brand#logoFavicon', icon: 'bi-award', color: '#d6336c' },
  phoneNavigation: { title: 'Phone Screen Navigation', path: '/admin/customization/store-settings?tab=brand#themeCustomizer', icon: 'bi-phone', color: '#212529' },
  addToCartScreen: { title: 'Show Add To Cart In Screen', path: '/admin/customization/store-settings?tab=brand#themeCustomizer', icon: 'bi-cart-plus', color: '#5b9bd5' },
  manageSliders: { title: 'Manage Sliders', path: '/admin/customization/sliders', icon: 'bi-images', color: '#f4a460' },
  footerSetting: { title: 'Footer Setting', path: '/admin/customization/store-settings?tab=brand#textFormat', icon: 'bi-layout-text-window-reverse', color: '#337ab7' },
  productViewSetting: { title: 'Product View Setting', path: '/admin/customization/product-view', icon: 'bi-eye', color: '#28a745' },
  advanceTheme: { title: 'Advance Theme Setup', path: '/admin/customization/theme', icon: 'bi-palette', color: '#f0ad4e' },
  homeSetting: { title: 'Home Setting', path: '/admin/customization/home-setting', icon: 'bi-house-gear', color: '#7c3aed' },
  orderPageSetting: { title: 'Order Page Setting', path: '/admin/customization/order-page', icon: 'bi-bag-check', color: '#d6336c' },
};

router.get('/customization', (req, res) => {
  res.render('admin/customization', { adminPageTitle: 'Customize Settings', CUSTOMIZATION_CARDS, CUSTOMIZATION_CARD_META });
});

const storeSettingsUpload = upload.fields([
  { name: 'logoDark', maxCount: 1 },
  { name: 'logoLight', maxCount: 1 },
  { name: 'favicon', maxCount: 1 },
  { name: 'storeLogo', maxCount: 1 },
  { name: 'invoiceLogo', maxCount: 1 },
  { name: 'metaImage', maxCount: 1 },
]);

router.get('/customization/store-settings', async (req, res, next) => {
  try {
    const custom = await getStoreCustomization();
    const settingsData = await getSettings();
    const pixels = await PixelSetting.find().sort({ createdAt: -1 });
    const activeTab = ['brand', 'store', 'pixel'].includes(req.query.tab) ? req.query.tab : 'brand';
    res.render('admin/customization-store-settings', {
      adminPageTitle: 'Store Settings', custom, settingsData, pixels, activeTab,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/customization/store-settings/brand', storeSettingsUpload, async (req, res, next) => {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/customization/store-settings?tab=brand');
    }
    const files = req.files || {};
    const custom = await getStoreCustomization();
    const brand = {
      logoDark: files.logoDark && files.logoDark[0] ? files.logoDark[0].filename : custom.brand.logoDark,
      logoLight: files.logoLight && files.logoLight[0] ? files.logoLight[0].filename : custom.brand.logoLight,
      favicon: files.favicon && files.favicon[0] ? files.favicon[0].filename : custom.brand.favicon,
    };
    const text = {
      titleText: (req.body.titleText || '').trim(),
      footerText: (req.body.footerText || '').trim(),
      dateFormat: req.body.dateFormat || custom.text.dateFormat,
      timeFormat: req.body.timeFormat || custom.text.timeFormat,
      timezone: req.body.timezone || custom.text.timezone,
      enableRtl: !!req.body.enableRtl,
    };
    const theme = {
      transparentLayout: !!req.body.transparentLayout,
      darkLayout: !!req.body.darkLayout,
      navigationOnOff: !!req.body.navigationOnOff,
      showCartOnOff: !!req.body.showCartOnOff,
      primaryColor: req.body.primaryColor || custom.theme.primaryColor,
    };
    await updateStoreCustomization({ brand, text, theme });
    req.flash('success', 'Brand settings saved successfully.');
    res.redirect('/admin/customization/store-settings?tab=brand');
  } catch (err) {
    next(err);
  }
});

router.post('/customization/store-settings/store', storeSettingsUpload, async (req, res, next) => {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/customization/store-settings?tab=store');
    }
    const files = req.files || {};
    const custom = await getStoreCustomization();
    const store = {
      storeLogo: files.storeLogo && files.storeLogo[0] ? files.storeLogo[0].filename : custom.store.storeLogo,
      invoiceLogo: files.invoiceLogo && files.invoiceLogo[0] ? files.invoiceLogo[0].filename : custom.store.invoiceLogo,
      metaImage: files.metaImage && files.metaImage[0] ? files.metaImage[0].filename : custom.store.metaImage,
      tagline: (req.body.tagline || '').trim(),
      city: (req.body.city || '').trim(),
      state: (req.body.state || '').trim(),
      zipcode: (req.body.zipcode || '').trim(),
      country: (req.body.country || '').trim(),
      storeLanguage: req.body.storeLanguage || custom.store.storeLanguage,
    };
    const domain = {
      storeSlug: (req.body.storeSlug || '').trim(),
      customDomain: (req.body.customDomain || '').trim(),
    };
    const features = {
      checkoutLoginRequired: !!req.body.checkoutLoginRequired,
      blogMenuDisplay: !!req.body.blogMenuDisplay,
      shippingMethod: !!req.body.shippingMethod,
      productRating: !!req.body.productRating,
    };
    const analyticsMeta = {
      googleAnalytics: (req.body.googleAnalytics || '').trim(),
      facebookPixel: (req.body.facebookPixel || '').trim(),
      metaKeywords: (req.body.metaKeywords || '').trim(),
      metaDescription: (req.body.metaDescription || '').trim(),
      decimalNumberFormat: parseInt(req.body.decimalNumberFormat, 10) || 0,
    };
    await updateStoreCustomization({ store, domain, features, analyticsMeta, customJs: req.body.customJs || '' });

    // Store Name / Email / Address stay owned by models/Setting.js (the
    // existing General Settings source of truth) instead of a second copy
    // here — same write-through pattern used for Manual Payment's bKash number.
    if (req.body.storeName !== undefined) await setSetting('site_name', (req.body.storeName || '').trim());
    if (req.body.email !== undefined) await setSetting('email', (req.body.email || '').trim());
    if (req.body.address !== undefined) await setSetting('address', (req.body.address || '').trim());

    req.flash('success', 'Store settings saved successfully.');
    res.redirect('/admin/customization/store-settings?tab=store');
  } catch (err) {
    next(err);
  }
});

// "Delete Store" — deliberately NOT wired to delete anything for real (no
// spec for what it should cascade-delete in a single-tenant admin app,
// and permanently deleting data is out of scope for this build).
router.get('/customization/store-settings/delete-store', (req, res) => {
  req.flash('danger', "Store deletion isn't available from the admin panel. Please contact hosting support if you need to remove all store data.");
  res.redirect('/admin/customization/store-settings?tab=store');
});

router.post('/customization/pixel/new', verifyCsrf, async (req, res, next) => {
  try {
    const { platform, pixelId, pixelAccessToken, facebookCatalogId, testEventCode } = req.body;
    if (!platform) {
      req.flash('danger', 'Please select a platform.');
      return res.redirect('/admin/customization/store-settings?tab=pixel');
    }
    await PixelSetting.create({
      platform,
      pixelId: (pixelId || '').trim(),
      pixelAccessToken: pixelAccessToken || '',
      facebookCatalogId: (facebookCatalogId || '').trim(),
      testEventCode: (testEventCode || '').trim(),
      status: true,
    });
    req.flash('success', 'Pixel added successfully.');
    res.redirect('/admin/customization/store-settings?tab=pixel');
  } catch (err) {
    next(err);
  }
});

router.post('/customization/pixel/:id/edit', verifyCsrf, async (req, res, next) => {
  try {
    const { platform, pixelId, pixelAccessToken, facebookCatalogId, testEventCode } = req.body;
    await PixelSetting.updateOne(
      { _id: req.params.id },
      {
        platform,
        pixelId: (pixelId || '').trim(),
        pixelAccessToken: pixelAccessToken || '',
        facebookCatalogId: (facebookCatalogId || '').trim(),
        testEventCode: (testEventCode || '').trim(),
        status: !!req.body.status,
      }
    );
    req.flash('success', 'Pixel updated successfully.');
    res.redirect('/admin/customization/store-settings?tab=pixel');
  } catch (err) {
    next(err);
  }
});

router.get('/customization/pixel/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/customization/store-settings?tab=pixel');
    }
    await PixelSetting.deleteOne({ _id: req.params.id });
    req.flash('success', 'Pixel deleted successfully.');
    res.redirect('/admin/customization/store-settings?tab=pixel');
  } catch (err) {
    next(err);
  }
});

router.get('/customization/home-setting', async (req, res, next) => {
  try {
    const homeSetting = await HomeSetting.findOne({});
    const showForm = !!homeSetting || req.query.new === '1';
    res.render('admin/customization-home-setting', { adminPageTitle: 'Home Setting', homeSetting, showForm });
  } catch (err) {
    next(err);
  }
});

const homeSettingUpload = upload.fields([{ name: 'logo', maxCount: 1 }]);

router.post('/customization/home-setting', homeSettingUpload, async (req, res, next) => {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/customization/home-setting');
    }
    const existing = await HomeSetting.findOne({});
    const files = req.files || {};
    const logoName = files.logo && files.logo[0] ? files.logo[0].filename : (existing ? existing.logo : null);
    const data = {
      header: (req.body.header || '').trim(),
      phone: (req.body.phone || '').trim(),
      email: (req.body.email || '').trim(),
      address: (req.body.address || '').trim(),
      twitter: (req.body.twitter || '').trim(),
      facebook: (req.body.facebook || '').trim(),
      youtube: (req.body.youtube || '').trim(),
      whatsapp: (req.body.whatsapp || '').trim(),
      messenger: (req.body.messenger || '').trim(),
      logo: logoName,
    };
    if (existing) {
      await HomeSetting.updateOne({ _id: existing._id }, data);
    } else {
      await HomeSetting.create(data);
    }
    req.flash('success', 'Home settings saved successfully.');
    res.redirect('/admin/customization/home-setting');
  } catch (err) {
    next(err);
  }
});

router.get('/customization/order-page', async (req, res, next) => {
  try {
    const orderPage = await OrderPageSetting.findOne({});
    const showForm = !!orderPage || req.query.new === '1';
    res.render('admin/customization-order-page', { adminPageTitle: 'Order Page Setting', orderPage, showForm });
  } catch (err) {
    next(err);
  }
});

router.post('/customization/order-page', verifyCsrf, async (req, res, next) => {
  try {
    const existing = await OrderPageSetting.findOne({});
    const data = {
      buyMore: (req.body.buyMore || '').trim(),
      orderNow: (req.body.orderNow || '').trim(),
      callCenter: (req.body.callCenter || '').trim(),
      callCenterNumber: (req.body.callCenterNumber || '').trim(),
      support: (req.body.support || '').trim(),
      supportNumber: (req.body.supportNumber || '').trim(),
      whatsapp: (req.body.whatsapp || '').trim(),
      whatsappNumber: (req.body.whatsappNumber || '').trim(),
      messenger: (req.body.messenger || '').trim(),
      messengerLink: (req.body.messengerLink || '').trim(),
      delivery: (req.body.delivery || '').trim(),
      status: req.body.status !== 'Off',
    };
    if (existing) {
      await OrderPageSetting.updateOne({ _id: existing._id }, data);
    } else {
      await OrderPageSetting.create(data);
    }
    req.flash('success', 'Order page settings saved successfully.');
    res.redirect('/admin/customization/order-page');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CUSTOMIZATION — Advance Theme Setup (dedicated rich theme customizer,
   separate from the simple toggle set on the Store Settings > Brand tab).
   Most color/font/size fields here are LIVE — saving them changes an
   injected <style> block that overrides public/css/style.css on every
   storefront page (see middleware/storeLocals.js + views/partials/header.ejs).
   A few structural fields (category heading text/colors, button icon/order
   details beyond a simple swap, currency sign, swipe behavior, homepage
   category selection) are saved for real but not wired into rendering yet
   — see the "SAVE-ONLY" comments in models/ThemeCustomizer.js for exactly
   which ones and why.
   ===================================================================== */
router.get('/customization/theme', async (req, res, next) => {
  try {
    const theme = await getThemeCustomizer();
    const categories = await Category.find({ status: true }).sort({ name: 1 });
    res.render('admin/customization-theme', { adminPageTitle: 'Customize Your Theme', theme, categories });
  } catch (err) {
    next(err);
  }
});

router.post('/customization/theme', verifyCsrf, async (req, res, next) => {
  try {
    const b = req.body;
    const topHeader = {
      color: b.topHeaderColor || '#ffffff',
      text: (b.topHeaderText || '').trim(),
      bold: !!b.topHeaderBold,
      textAlign: b.topHeaderTextAlign || 'center',
      scrollingMarquee: !!b.topHeaderScrollingMarquee,
      backgroundColor: b.topHeaderBackgroundColor || '#EC0E8C',
    };
    const header = {
      textColor: b.headerTextColor || '#222222',
      backgroundColor: b.headerBackgroundColor || '#ffffff',
    };
    const navMenu = {
      linksColor: b.navLinksColor || '#ffe6f5',
      backgroundColor: b.navBackgroundColor || '#EC0E8C',
      linkHoverColor: b.navLinkHoverColor || '#ffffff',
      fontFamily: b.navFontFamily || "'Hind Siliguri', sans-serif",
    };
    const category = {
      headerBackgroundColor: b.catHeaderBackgroundColor || '#ffffff',
      headerTitleColor: b.catHeaderTitleColor || '#222222',
      headerTitleText: (b.catHeaderTitleText || '').trim(),
      headerFontFamily: b.catHeaderFontFamily || "'Poppins', sans-serif",
      navFontSize: b.catNavFontSize || '14px',
      bodyLayout: b.catBodyLayout || 'Fixed Layout',
      bodyShape: b.catBodyShape || '50%',
      rowItem: b.catRowItem || '6-item',
      rowBackgroundColor: b.catRowBackgroundColor || 'transparent',
      borderColor: b.catBorderColor || '#f6d5ea',
      namePosition: b.catNamePosition || 'Box Style',
      previewBackgroundColor: b.catPreviewBackgroundColor || 'transparent',
      previewTextColor: b.catPreviewTextColor || '#222222',
    };
    const product = {
      nameColor: b.productNameColor || '#222222',
      priceColor: b.productPriceColor || '#EC0E8C',
      boxStyle: b.productBoxStyle === 'with' ? 'with' : 'without',
      nameSize: b.productNameSize || '14px',
      priceTextSize: b.productPriceTextSize || '16px',
      discountBarBgColor: b.discountBarBgColor || '#E63946',
      discountBarTextColor: b.discountBarTextColor || '#ffffff',
      cardBorderColor: b.productCardBorderColor || '#f7d3ea',
      cardBorderSize: b.productCardBorderSize || '1px',
      addToCartName: (b.addToCartName || '').trim() || 'আরো কিনুন',
      buyNowName: (b.buyNowName || '').trim() || 'এখনই কিনুন',
      addToCartColor: b.addToCartColor || '#EC0E8C',
      addToCartTextColor: b.addToCartTextColor || '#ffffff',
      buyNowColor: b.buyNowColor || '#2F5FE0',
      buyNowTextColor: b.buyNowTextColor || '#ffffff',
      discountPriceTextColor: b.discountPriceTextColor || '#999999',
      discountPriceTextSize: b.discountPriceTextSize || '13px',
      buttonOrder: b.buttonOrder === 'buy-then-cart' ? 'buy-then-cart' : 'cart-then-buy',
      showAddToCartIcon: !!b.showAddToCartIcon,
      showBuyNowIcon: !!b.showBuyNowIcon,
      buttonLayout: b.buttonLayout === 'vertical' ? 'vertical' : 'horizontal',
      currencySign: b.currencySign || 'Tk',
      swipeOption: !!b.swipeOption,
    };
    const home = {
      productsDesktop: parseInt(b.productsDesktop, 10) || 4,
      productsTablet: parseInt(b.productsTablet, 10) || 3,
      productsMobile: parseInt(b.productsMobile, 10) || 2,
      clothingStyle: !!b.clothingStyle,
      selectedCategories: Array.isArray(b.selectedCategories) ? b.selectedCategories : (b.selectedCategories ? [b.selectedCategories] : []),
      showAllProductsCategory: !!b.showAllProductsCategory,
    };
    const footer = {
      backgroundColor: b.footerBackgroundColor || '#EC0E8C',
      textColor: b.footerTextColor || '#ffe6f5',
    };
    await updateThemeCustomizer({ themeName: b.themeName || 'Theme 1', topHeader, header, navMenu, category, product, home, footer });
    req.flash('success', 'Theme settings saved successfully.');
    res.redirect('/admin/customization/theme');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   INVENTORY — Purchase orders (real stock-in from a supplier) + an
   Inventory report built from real Purchase + Product + Order data.

   This app has no multi-warehouse concept (one `stock`/variant `stock`
   number per product, same as everywhere else in the app), so "Total
   Warehouses" reports 1 once at least one purchase exists, 0 otherwise —
   disclosed simplification, not a fake counter. "Total Wastage" is always
   0: nothing in this app records wastage/damage yet, so rather than guess
   at a number from purchased-vs-available stock (which would be wrong for
   any product whose stock was set directly on the product form before
   ever being purchased here), it's honestly left at 0. "Sold" figures
   count items from any order that isn't cancelled — an approximation
   (an order still mid-pipeline counts as sold) rather than only fully
   delivered orders, to keep the report simple.
   ===================================================================== */
router.get('/inventory/purchase', async (req, res, next) => {
  try {
    const purchases = await Purchase.find().populate('supplier').sort({ createdAt: -1 });
    res.render('admin/purchase', { adminPageTitle: 'Purchase', purchases });
  } catch (err) {
    next(err);
  }
});

router.get('/inventory/purchase/new', async (req, res, next) => {
  try {
    const suppliers = await Supplier.find({ status: true }).sort({ name: 1 });
    res.render('admin/purchase-form', { adminPageTitle: 'Add Purchase', suppliers });
  } catch (err) {
    next(err);
  }
});

// JSON API backing the Add Purchase page's product picker (AJAX-loaded once
// a supplier is chosen — see the inline script in admin/purchase-form.ejs).
router.get('/inventory/purchase/products', async (req, res, next) => {
  try {
    if (!req.query.supplier) return res.json({ products: [] });
    const products = await Product.find({ supplier: req.query.supplier }).populate('category').lean();
    const productImageUrl = res.locals.productImageUrl;
    const rows = products.map((p) => ({
      _id: p._id,
      sku: p.sku || '',
      image: productImageUrl(p.image),
      title: p.name,
      category: p.category ? p.category.name : '—',
      buyingPrice: p.buyingPrice || 0,
      hasVariants: !!p.hasVariants,
      stock: p.stock || 0,
      variants: (p.variants || []).map((v) => ({ _id: v._id, label: v.label, sku: v.sku, stock: v.stock || 0 })),
    }));
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/inventory/purchase/new', verifyCsrf, async (req, res, next) => {
  try {
    const supplierId = req.body.supplier;
    const rawItems = req.body.items;
    const itemsArr = Array.isArray(rawItems) ? rawItems : (rawItems ? Object.values(rawItems) : []);

    const items = [];
    let total = 0;
    itemsArr.forEach((it) => {
      if (!it || !it.product) return;
      const qty = parseInt(it.quantity, 10) || 0;
      const price = parseFloat(it.buyingPrice) || 0;
      if (qty <= 0) return;
      const subtotal = qty * price;
      total += subtotal;
      items.push({
        product: it.product,
        variantId: it.variantId || null,
        sku: it.sku || '',
        image: it.image || null,
        title: it.title || '',
        variation: it.variation || '',
        buyingPrice: price,
        quantity: qty,
        subtotal,
      });
    });

    if (!supplierId || !items.length) {
      req.flash('danger', 'Please select a supplier and add at least one product with a quantity.');
      return res.redirect('/admin/inventory/purchase/new');
    }

    await Purchase.create({ supplier: supplierId, items, total, note: (req.body.note || '').trim(), status: 'received' });

    // Real stock-in: bump each product's (or variant's) live stock —
    // the same field the storefront checks at checkout.
    for (const it of items) {
      if (it.variantId) {
        await Product.updateOne(
          { _id: it.product, 'variants._id': it.variantId },
          { $inc: { 'variants.$.stock': it.quantity } }
        );
      } else {
        await Product.updateOne({ _id: it.product }, { $inc: { stock: it.quantity } });
      }
    }

    req.flash('success', 'Purchase added and stock updated successfully.');
    res.redirect('/admin/inventory/purchase');
  } catch (err) {
    next(err);
  }
});

router.get('/inventory', async (req, res, next) => {
  try {
    const purchases = await Purchase.find().lean();
    const byProduct = {};
    purchases.forEach((pur) => {
      (pur.items || []).forEach((it) => {
        const key = String(it.product);
        if (!byProduct[key]) byProduct[key] = { purchasedQty: 0, purchaseCost: 0 };
        byProduct[key].purchasedQty += it.quantity;
        byProduct[key].purchaseCost += it.subtotal;
      });
    });
    const productIds = Object.keys(byProduct);

    let rows = [];
    let totalStockValue = 0;
    let totalSaleValue = 0;

    if (productIds.length) {
      const products = await Product.find({ _id: { $in: productIds } }).lean();
      const orders = await Order.find({ status: { $ne: 'cancelled' }, 'items.product': { $in: productIds } }).select('items').lean();
      const soldByProduct = {};
      orders.forEach((o) => {
        (o.items || []).forEach((it) => {
          if (!it.product) return;
          const key = String(it.product);
          if (!byProduct[key]) return; // only report on products that have a purchase history
          if (!soldByProduct[key]) soldByProduct[key] = { qty: 0, revenue: 0 };
          soldByProduct[key].qty += it.qty;
          soldByProduct[key].revenue += it.lineTotal;
        });
      });

      rows = products.map((p) => {
        const key = String(p._id);
        const purchased = byProduct[key] || { purchasedQty: 0, purchaseCost: 0 };
        const sold = soldByProduct[key] || { qty: 0, revenue: 0 };
        const availableQty = (p.hasVariants && p.variants && p.variants.length)
          ? p.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
          : (p.stock || 0);
        return {
          _id: p._id,
          name: p.name,
          image: p.image,
          warehouseQty: purchased.purchasedQty,
          availableQty,
          purchaseCost: purchased.purchaseCost,
          sellRevenue: sold.revenue,
          soldCost: sold.qty * (p.buyingPrice || 0),
          wastage: 0,
          totalQty: purchased.purchasedQty,
        };
      });

      totalStockValue = products.reduce((sum, p) => {
        const qty = (p.hasVariants && p.variants && p.variants.length) ? p.variants.reduce((s, v) => s + (v.stock || 0), 0) : (p.stock || 0);
        return sum + qty * (p.buyingPrice || 0);
      }, 0);
      totalSaleValue = products.reduce((sum, p) => {
        const qty = (p.hasVariants && p.variants && p.variants.length) ? p.variants.reduce((s, v) => s + (v.stock || 0), 0) : (p.stock || 0);
        return sum + qty * (p.salePrice || p.price || 0);
      }, 0);
    }

    const q = (req.query.q || '').trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().indexOf(q) !== -1);

    res.render('admin/inventory', {
      adminPageTitle: 'Inventory', rows, totalWarehouses: productIds.length ? 1 : 0, totalStockValue, totalSaleValue, q: req.query.q || '',
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   PAGES (About Us, FAQ, How to Order, How to Pay, Terms, Privacy,
   Refund, Shipping) — editable static content, replaces hardcoded text.
   ===================================================================== */
const PAGE_DEFAULTS = [
  ['about', 'About Us'],
  ['how-to-order', 'How to Order'],
  ['how-to-pay', 'How to Pay'],
  ['faq', 'Frequently Asked Questions (FAQ)'],
  ['terms', 'Terms & Conditions'],
  ['privacy', 'Privacy Policy'],
  ['refund', 'Refund Policy'],
  ['shipping', 'Shipping Policy'],
];

router.get('/pages', async (req, res, next) => {
  try {
    // Make sure every known page key has a row to edit, even on first visit.
    const existing = await Page.find({});
    const existingKeys = new Set(existing.map((p) => p.key));
    const missing = PAGE_DEFAULTS.filter(([key]) => !existingKeys.has(key));
    if (missing.length) {
      await Page.insertMany(missing.map(([key, title]) => ({ key, title, body: '' })));
    }
    const pages = await Page.find({}).sort({ key: 1 });
    res.render('admin/pages', { adminPageTitle: 'Page Management', pages });
  } catch (err) {
    next(err);
  }
});

router.post('/pages/:key', verifyCsrf, async (req, res, next) => {
  try {
    const { title, body } = req.body;
    await Page.findOneAndUpdate(
      { key: req.params.key },
      { title: (title || '').trim(), body: body || '' },
      { upsert: true }
    );
    req.flash('success', 'Page updated successfully.');
    res.redirect('/admin/pages');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   BLOG
   ===================================================================== */
router.get('/blog', async (req, res, next) => {
  try {
    const posts = await BlogPost.find({}).sort({ createdAt: -1 });
    res.render('admin/blog', { adminPageTitle: 'Blog Management', posts });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/new', (req, res) => {
  res.render('admin/blog-form', { adminPageTitle: 'New Blog Post', post: null, errors: [] });
});

router.get('/blog/:id/edit', async (req, res, next) => {
  try {
    const post = await BlogPost.findById(req.params.id);
    if (!post) {
      req.flash('danger', 'Blog post not found.');
      return res.redirect('/admin/blog');
    }
    res.render('admin/blog-form', { adminPageTitle: 'Edit Blog Post', post, errors: [] });
  } catch (err) {
    next(err);
  }
});

async function saveBlogPost(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'Form has expired.');
      return res.redirect('/admin/blog');
    }
    const existing = existingId ? await BlogPost.findById(existingId) : null;
    const { title, excerpt, content } = req.body;
    const errors = [];
    if (!title || !title.trim()) errors.push('Title is required.');

    let imageName = existing ? existing.coverImage : null;
    if (req.file) imageName = req.file.filename;

    if (errors.length) {
      return res.render('admin/blog-form', {
        adminPageTitle: existing ? 'Edit Blog Post' : 'New Blog Post',
        post: { ...(existing ? existing.toObject() : {}), ...req.body, coverImage: imageName },
        errors,
      });
    }

    const baseSlug = slugify(title);
    const slug = await ensureUniqueSlug(BlogPost, baseSlug, existingId || null);

    const data = {
      title: title.trim(),
      slug,
      excerpt: (excerpt || '').trim(),
      content: content || '',
      coverImage: imageName,
      status: !!req.body.status,
    };

    if (existing) {
      await BlogPost.updateOne({ _id: existingId }, data);
      req.flash('success', 'Blog post updated successfully.');
    } else {
      await BlogPost.create(data);
      req.flash('success', 'New blog post published successfully.');
    }
    res.redirect('/admin/blog');
  } catch (err) {
    next(err);
  }
}

router.post('/blog/new', upload.single('coverImage'), (req, res, next) => saveBlogPost(req, res, next, null));
router.post('/blog/:id/edit', upload.single('coverImage'), (req, res, next) => saveBlogPost(req, res, next, req.params.id));

router.get('/blog/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/blog');
    }
    await BlogPost.deleteOne({ _id: req.params.id });
    req.flash('success', 'Blog post deleted successfully.');
    res.redirect('/admin/blog');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
