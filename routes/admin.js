const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

const Category = require('../models/Category');
const Brand = require('../models/Brand');
const VariantAttribute = require('../models/VariantAttribute');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Admin = require('../models/Admin');
const DeliveryCommissionSetup = require('../models/DeliveryCommissionSetup');
const DeliveryRequest = require('../models/DeliveryRequest');
const Page = require('../models/Page');
const BlogPost = require('../models/BlogPost');
const { getSettings, setSetting } = require('../models/Setting');
const { getOrderSettings, updateOrderSettingCard } = require('../models/OrderSetting');
const { getMarketingSettings, updateMarketingSettingCard } = require('../models/MarketingSetting');
const { sendSms } = require('../lib/sms');

const adminLocals = require('../middleware/adminLocals');
const { requireAdminLogin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const upload = require('../middleware/upload');
const { slugify, ensureUniqueSlug } = require('../middleware/helpers');
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
    const { username, password } = req.body;
    const admin = await Admin.findOne({ $or: [{ username }, { email: (username || '').toLowerCase() }] });
    if (admin && (await bcrypt.compare(password, admin.password))) {
      req.session.adminId = admin._id;
      return res.redirect('/admin');
    }
    res.render('admin/login', { errors: ['Incorrect username or password.'], formData: req.body });
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
   below, Manage Delivery, Staff, Marketing, Customers, Settings, Blog,
   Pages) are NOT in this list — they have their own routes.
   Registered FIRST (before any /orders/:id-style wildcard route further
   down) so an exact path like /orders/incomplete is never swallowed by
   a wildcard route meant for a real order id.
   ===================================================================== */
const COMING_SOON_PAGES = {
  '/analytics': 'Analytics',

  '/landing-page/main': 'Main Landing Page',
  '/landing-page/short': 'Short Landing Page',
  '/landing-page/checkout': 'Landing Checkout',
  '/landing-page/advance': 'Advance Landing Page',

  '/customization': 'Customization',

  '/inventory': 'Inventory',
  '/inventory/purchase': 'Purchase',

  '/offer/flash-sale': 'Flash Sale',
  '/offer/combo': 'Combo Offer',
  '/offer/best-sale': 'Best Sale Products',
  '/offer/popular': 'Popular Products',
  '/offer/hot-deal': 'Hot Deal',
  '/offer/special': 'Special Offer',
  '/offer/latest': 'Latest Products',
  '/offer/popup': 'PopUp Offer',

  '/accounting/income': 'Income',
  '/accounting/expenses': 'Expenses',
  '/accounting/expense-list': 'Expense List',
  '/accounting/due-payment': 'Due Payment',
  '/accounting/employee-salary': 'Employee Salary',
  '/accounting/bill-statements': 'Bill Statements',
  '/accounting/balance-transfer': 'Balance Transfer',
  '/accounting/balance-overview': 'Balance Overview',

  '/task-management': 'Task Management',
  '/pos': 'POS',

  // Still coming soon — no distinct UI/spec provided for these yet.
  '/orders/follow-up': 'Follow Up',
  '/orders/user-activity': 'User Activity',
  '/orders/near-by': 'Near By Orders',
  '/orders/blocked': 'Order Block',
  '/orders/store-analytics': 'Store Analytics',

  '/referral-program': 'Referral Program',
  '/our-service': 'Our Service',
  '/help-support': 'Help & Support',
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
   STAFF
   ---------------------------------------------------------------------
   Every "Employee" used across Order Management / Manage Delivery
   (Order.assignedEmployee, Order.delivery.deliveryMan) is one of these
   Admin accounts — this is where they actually get created, so those
   dropdowns have someone in them. `role` is a free-text label only
   (e.g. "Delivery Man", "Manager") — there's no access control tied to
   it anywhere in this app.
   ===================================================================== */
router.get('/staff', async (req, res, next) => {
  try {
    const staff = await Admin.find().sort({ createdAt: -1 });
    res.render('admin/staff', { adminPageTitle: 'Staff', staff, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/staff', verifyCsrf, async (req, res, next) => {
  try {
    const { id, username, email, fullName, role, password } = req.body;
    const errors = [];
    if (!username || !username.trim()) errors.push('Username is required.');
    if (!email || !email.trim()) errors.push('Email is required.');
    if (!id && (!password || password.length < 4)) errors.push('Password must be at least 4 characters.');

    if (!errors.length) {
      const dupe = await Admin.findOne({
        _id: { $ne: id || null },
        $or: [{ username: (username || '').trim() }, { email: (email || '').trim().toLowerCase() }],
      });
      if (dupe) errors.push('That username or email is already in use.');
    }

    if (errors.length) {
      const staff = await Admin.find().sort({ createdAt: -1 });
      return res.render('admin/staff', { adminPageTitle: 'Staff', staff, errors });
    }

    const data = {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      fullName: (fullName || '').trim(),
      role: (role || '').trim() || 'admin',
    };
    if (password) data.password = await bcrypt.hash(password, 10);

    if (id) {
      await Admin.updateOne({ _id: id }, data);
      req.flash('success', 'Staff account updated successfully.');
    } else {
      await Admin.create(data);
      req.flash('success', 'New staff account created successfully.');
    }
    res.redirect('/admin/staff');
  } catch (err) {
    next(err);
  }
});

router.get('/staff/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'Invalid request.');
      return res.redirect('/admin/staff');
    }
    if (String(req.params.id) === String(req.session.adminId)) {
      req.flash('danger', "You can't delete the account you're currently logged in as.");
      return res.redirect('/admin/staff');
    }
    await Admin.deleteOne({ _id: req.params.id });
    req.flash('success', 'Staff account deleted successfully.');
    res.redirect('/admin/staff');
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
   SETTINGS
   ===================================================================== */
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('admin/settings', { adminPageTitle: 'Site Settings', settingsData: settings });
  } catch (err) {
    next(err);
  }
});

router.post('/settings', verifyCsrf, async (req, res, next) => {
  try {
    const keys = ['site_name', 'site_tagline', 'currency_symbol', 'flat_shipping_fee', 'bkash_number', 'phone', 'email', 'address'];
    await Promise.all(keys.map((key) => (req.body[key] !== undefined ? setSetting(key, req.body[key]) : null)));
    req.flash('success', 'Settings saved successfully.');
    res.redirect('/admin/settings');
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
