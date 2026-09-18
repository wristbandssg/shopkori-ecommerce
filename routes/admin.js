const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

const Category = require('../models/Category');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Admin = require('../models/Admin');
const Page = require('../models/Page');
const BlogPost = require('../models/BlogPost');
const { getSettings, setSetting } = require('../models/Setting');

const adminLocals = require('../middleware/adminLocals');
const { requireAdminLogin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const upload = require('../middleware/upload');
const { slugify, ensureUniqueSlug } = require('../middleware/helpers');

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
      return res.render('admin/login', { errors: ['ফর্ম মেয়াদোত্তীর্ণ হয়েছে।'], formData: req.body });
    }
    const { username, password } = req.body;
    const admin = await Admin.findOne({ $or: [{ username }, { email: (username || '').toLowerCase() }] });
    if (admin && (await bcrypt.compare(password, admin.password))) {
      req.session.adminId = admin._id;
      return res.redirect('/admin');
    }
    res.render('admin/login', { errors: ['ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।'], formData: req.body });
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
   Real, working modules (Products, Category, Orders, Customers,
   Settings, Blog, Pages) are NOT in this list — they have their own
   routes below.
   Registered FIRST (before any /orders/:id-style wildcard route further
   down) so an exact path like /orders/incomplete is never swallowed by
   a wildcard route meant for a real order id.
   ===================================================================== */
const COMING_SOON_PAGES = {
  '/marketing': 'মার্কেটিং',
  '/analytics': 'অ্যানালিটিক্স',

  '/landing-page/main': 'মেইন ল্যান্ডিং পেজ',
  '/landing-page/short': 'শর্ট ল্যান্ডিং পেজ',
  '/landing-page/checkout': 'ল্যান্ডিং চেকআউট',
  '/landing-page/advance': 'অ্যাডভান্স ল্যান্ডিং পেজ',

  '/customization': 'কাস্টমাইজেশন',

  '/products/variant': 'ভ্যারিয়েন্ট',
  '/products/brands': 'ব্র্যান্ডস',
  '/products/supplier': 'সাপ্লায়ার',

  '/inventory': 'ইনভেন্টরি',
  '/inventory/purchase': 'পারচেজ',

  '/offer/flash-sale': 'ফ্ল্যাশ সেল',
  '/offer/combo': 'কম্বো অফার',
  '/offer/best-sale': 'বেস্ট সেল প্রোডাক্টস',
  '/offer/popular': 'পপুলার প্রোডাক্টস',
  '/offer/hot-deal': 'হট ডিল',
  '/offer/special': 'স্পেশাল অফার',
  '/offer/latest': 'লেটেস্ট প্রোডাক্টস',
  '/offer/popup': 'পপআপ অফার',

  '/staff': 'স্টাফ',

  '/accounting/income': 'ইনকাম',
  '/accounting/expenses': 'এক্সপেন্স',
  '/accounting/expense-list': 'এক্সপেন্স লিস্ট',
  '/accounting/due-payment': 'বকেয়া পেমেন্ট',
  '/accounting/employee-salary': 'কর্মচারী বেতন',
  '/accounting/bill-statements': 'বিল স্টেটমেন্ট',
  '/accounting/balance-transfer': 'ব্যালেন্স ট্রান্সফার',
  '/accounting/balance-overview': 'ব্যালেন্স ওভারভিউ',

  '/task-management': 'টাস্ক ম্যানেজমেন্ট',
  '/pos': 'POS',

  '/delivery/delivery-man': 'ডেলিভারি ম্যান',
  '/delivery/delivered': 'ডেলিভার্ড অর্ডার',
  '/delivery/clear': 'ক্লিয়ার ডেলিভারি',
  '/delivery/cancelled': 'ক্যান্সেল্ড অর্ডার',
  '/delivery/return-confirm': 'রিটার্ন কনফার্ম',
  '/delivery/amount-request': 'অ্যামাউন্ট রিকোয়েস্ট',
  '/delivery/commission': 'ডেলিভারি কমিশন',
  '/delivery/commission-request': 'কমিশন রিকোয়েস্ট',

  '/orders/incomplete': 'অসম্পূর্ণ অর্ডার',
  '/orders/returned': 'রিটার্ন অর্ডার',
  '/orders/delivery-issue': 'ডেলিভারি ইস্যু',
  '/orders/follow-up': 'ফলো আপ',
  '/orders/user-activity': 'ইউজার অ্যাক্টিভিটি',
  '/orders/near-by': 'নিয়ারবাই অর্ডার',
  '/orders/blocked': 'ব্লক করা অর্ডার',
  '/orders/deleted': 'ডিলিট করা অর্ডার',
  '/orders/setting': 'অর্ডার সেটিং',
  '/orders/missed': 'মিসড অর্ডার',
  '/orders/after-confirm': 'আফটার কনফার্ম',
  '/orders/store-analytics': 'স্টোর অ্যানালিটিক্স',

  '/referral-program': 'রেফারেল প্রোগ্রাম',
  '/our-service': 'আমাদের সার্ভিস',
  '/help-support': 'হেল্প ও সাপোর্ট',
};

Object.keys(COMING_SOON_PAGES).forEach((subPath) => {
  router.get(subPath, (req, res) => {
    res.render('admin/coming-soon', { adminPageTitle: COMING_SOON_PAGES[subPath] });
  });
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
      adminPageTitle: 'ড্যাশবোর্ড',
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
   PRODUCTS
   ===================================================================== */
router.get('/products', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const filter = q ? { $or: [{ name: new RegExp(q, 'i') }, { sku: new RegExp(q, 'i') }] } : {};
    const products = await Product.find(filter).populate('category').sort({ createdAt: -1 });
    res.render('admin/products', { adminPageTitle: 'প্রোডাক্ট ম্যানেজমেন্ট', products, q });
  } catch (err) {
    next(err);
  }
});

router.get('/products/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'অবৈধ রিকোয়েস্ট।');
      return res.redirect('/admin/products');
    }
    await Product.deleteOne({ _id: req.params.id });
    req.flash('success', 'প্রোডাক্ট ডিলিট করা হয়েছে।');
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
});

router.get('/products/new', async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.render('admin/product-form', { adminPageTitle: 'নতুন প্রোডাক্ট যোগ করুন', product: null, categories, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id/edit', async (req, res, next) => {
  try {
    const [product, categories] = await Promise.all([Product.findById(req.params.id), Category.find().sort({ name: 1 })]);
    if (!product) {
      req.flash('danger', 'প্রোডাক্ট পাওয়া যায়নি।');
      return res.redirect('/admin/products');
    }
    res.render('admin/product-form', { adminPageTitle: 'প্রোডাক্ট এডিট করুন', product, categories, errors: [] });
  } catch (err) {
    next(err);
  }
});

async function saveProduct(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'ফর্ম মেয়াদোত্তীর্ণ হয়েছে।');
      return res.redirect('/admin/products');
    }
    const categories = await Category.find().sort({ name: 1 });
    const existing = existingId ? await Product.findById(existingId) : null;

    const { name, categoryId, sku, shortDescription, description, price, salePrice, stock } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('প্রোডাক্টের নাম আবশ্যক।');
    const priceNum = parseFloat(price);
    const salePriceNum = salePrice ? parseFloat(salePrice) : null;
    if (!priceNum || priceNum <= 0) errors.push('সঠিক মূল্য দিন।');
    if (salePriceNum !== null && salePriceNum >= priceNum) errors.push('সেল প্রাইস মূল প্রাইসের চেয়ে কম হতে হবে।');

    let imageName = existing ? existing.image : null;
    if (req.file) {
      imageName = req.file.filename;
    }

    if (errors.length) {
      return res.render('admin/product-form', {
        adminPageTitle: existing ? 'প্রোডাক্ট এডিট করুন' : 'নতুন প্রোডাক্ট যোগ করুন',
        product: { ...(existing ? existing.toObject() : {}), ...req.body, image: imageName },
        categories,
        errors,
      });
    }

    const baseSlug = slugify(name);
    const slug = await ensureUniqueSlug(Product, baseSlug, existingId || null);

    const data = {
      category: categoryId || null,
      name: name.trim(),
      slug,
      sku: (sku || '').trim(),
      shortDescription: (shortDescription || '').trim(),
      description: (description || '').trim(),
      price: priceNum,
      salePrice: salePriceNum,
      stock: parseInt(stock, 10) || 0,
      image: imageName || 'product-placeholder.svg',
      isFeatured: !!req.body.isFeatured,
      isFlashSale: !!req.body.isFlashSale,
      status: !!req.body.status,
    };

    if (existing) {
      await Product.updateOne({ _id: existingId }, data);
      req.flash('success', 'প্রোডাক্ট আপডেট হয়েছে।');
    } else {
      await Product.create(data);
      req.flash('success', 'নতুন প্রোডাক্ট যোগ করা হয়েছে।');
    }
    res.redirect('/admin/products');
  } catch (err) {
    next(err);
  }
}

router.post('/products/new', upload.single('image'), (req, res, next) => saveProduct(req, res, next, null));
router.post('/products/:id/edit', upload.single('image'), (req, res, next) => saveProduct(req, res, next, req.params.id));

/* =====================================================================
   CATEGORIES
   ===================================================================== */
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
    // Only top-level categories can be picked as a "parent" — the storefront
    // mega menu only nests 2 levels deep (category -> subcategory).
    const parentOptions = categories.filter((c) => !c.parent);
    res.render('admin/categories', { adminPageTitle: 'ক্যাটাগরি ম্যানেজমেন্ট', categories, parentOptions });
  } catch (err) {
    next(err);
  }
});

// upload.single runs before verifyCsrf here because multer is what parses
// multipart/form-data — req.body (and so req.body.csrfToken) isn't populated
// until after it runs.
router.post('/categories', upload.single('image'), verifyCsrf, async (req, res, next) => {
  try {
    const { id, name, sortOrder, parent } = req.body;
    if (!name || !name.trim()) return res.redirect('/admin/categories');

    // A category can't be its own parent, and we only support 2 levels deep.
    const parentId = parent && parent !== id ? parent : null;

    const existing = id ? await Category.findById(id) : null;
    let imageName = existing ? existing.image : null;
    if (req.file) imageName = req.file.filename;

    if (id) {
      const slug = await ensureUniqueSlug(Category, slugify(name), id);
      await Category.updateOne(
        { _id: id },
        { name, slug, sortOrder: parseInt(sortOrder, 10) || 0, status: !!req.body.status, parent: parentId, image: imageName }
      );
      req.flash('success', 'ক্যাটাগরি আপডেট হয়েছে।');
    } else {
      const slug = await ensureUniqueSlug(Category, slugify(name), null);
      await Category.create({ name, slug, sortOrder: parseInt(sortOrder, 10) || 0, status: !!req.body.status, parent: parentId, image: imageName });
      req.flash('success', 'নতুন ক্যাটাগরি যোগ করা হয়েছে।');
    }
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
});

router.get('/categories/delete/:id', async (req, res, next) => {
  try {
    if (req.query.csrf !== req.session.csrfToken) {
      req.flash('danger', 'অবৈধ রিকোয়েস্ট।');
      return res.redirect('/admin/categories');
    }
    await Category.deleteOne({ _id: req.params.id });
    req.flash('success', 'ক্যাটাগরি ডিলিট করা হয়েছে।');
    res.redirect('/admin/categories');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   ORDERS
   ===================================================================== */
router.get('/orders', async (req, res, next) => {
  try {
    const { status, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { orderNumber: new RegExp(q, 'i') },
        { customerName: new RegExp(q, 'i') },
        { customerPhone: new RegExp(q, 'i') },
      ];
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.render('admin/orders', { adminPageTitle: 'অর্ডার ম্যানেজমেন্ট', orders, status: status || '', q: q || '' });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      req.flash('danger', 'অর্ডার পাওয়া যায়নি।');
      return res.redirect('/admin/orders');
    }
    res.render('admin/order-view', { adminPageTitle: `অর্ডার #${order.orderNumber}`, order });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id', verifyCsrf, async (req, res, next) => {
  try {
    const { status, paymentStatus } = req.body;
    await Order.updateOne({ _id: req.params.id }, { status, paymentStatus });
    req.flash('success', 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।');
    res.redirect(`/admin/orders/${req.params.id}`);
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

    res.render('admin/customers', { adminPageTitle: 'কাস্টমার ম্যানেজমেন্ট', customers, q });
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
      adminPageTitle: 'সেলস রিপোর্ট ও অ্যানালিটিক্স',
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
    res.render('admin/settings', { adminPageTitle: 'সাইট সেটিংস', settingsData: settings });
  } catch (err) {
    next(err);
  }
});

router.post('/settings', verifyCsrf, async (req, res, next) => {
  try {
    const keys = ['site_name', 'site_tagline', 'currency_symbol', 'flat_shipping_fee', 'bkash_number', 'phone', 'email', 'address'];
    await Promise.all(keys.map((key) => (req.body[key] !== undefined ? setSetting(key, req.body[key]) : null)));
    req.flash('success', 'সেটিংস সংরক্ষণ করা হয়েছে।');
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
  ['about', 'আমাদের সম্পর্কে'],
  ['how-to-order', 'কিভাবে অর্ডার করবেন'],
  ['how-to-pay', 'কিভাবে পেমেন্ট করবেন'],
  ['faq', 'সচরাচর জিজ্ঞাসিত প্রশ্ন (FAQ)'],
  ['terms', 'শর্তাবলী'],
  ['privacy', 'প্রাইভেসি পলিসি'],
  ['refund', 'রিফান্ড পলিসি'],
  ['shipping', 'শিপিং পলিসি'],
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
    res.render('admin/pages', { adminPageTitle: 'পেজ ম্যানেজমেন্ট', pages });
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
    req.flash('success', 'পেজ আপডেট হয়েছে।');
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
    res.render('admin/blog', { adminPageTitle: 'ব্লগ ম্যানেজমেন্ট', posts });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/new', (req, res) => {
  res.render('admin/blog-form', { adminPageTitle: 'নতুন ব্লগ পোস্ট', post: null, errors: [] });
});

router.get('/blog/:id/edit', async (req, res, next) => {
  try {
    const post = await BlogPost.findById(req.params.id);
    if (!post) {
      req.flash('danger', 'ব্লগ পোস্ট পাওয়া যায়নি।');
      return res.redirect('/admin/blog');
    }
    res.render('admin/blog-form', { adminPageTitle: 'ব্লগ পোস্ট এডিট করুন', post, errors: [] });
  } catch (err) {
    next(err);
  }
});

async function saveBlogPost(req, res, next, existingId) {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'ফর্ম মেয়াদোত্তীর্ণ হয়েছে।');
      return res.redirect('/admin/blog');
    }
    const existing = existingId ? await BlogPost.findById(existingId) : null;
    const { title, excerpt, content } = req.body;
    const errors = [];
    if (!title || !title.trim()) errors.push('শিরোনাম আবশ্যক।');

    let imageName = existing ? existing.coverImage : null;
    if (req.file) imageName = req.file.filename;

    if (errors.length) {
      return res.render('admin/blog-form', {
        adminPageTitle: existing ? 'ব্লগ পোস্ট এডিট করুন' : 'নতুন ব্লগ পোস্ট',
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
      req.flash('success', 'ব্লগ পোস্ট আপডেট হয়েছে।');
    } else {
      await BlogPost.create(data);
      req.flash('success', 'নতুন ব্লগ পোস্ট প্রকাশ করা হয়েছে।');
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
      req.flash('danger', 'অবৈধ রিকোয়েস্ট।');
      return res.redirect('/admin/blog');
    }
    await BlogPost.deleteOne({ _id: req.params.id });
    req.flash('success', 'ব্লগ পোস্ট ডিলিট করা হয়েছে।');
    res.redirect('/admin/blog');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
