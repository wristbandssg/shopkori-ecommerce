const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

const Category = require('../models/Category');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Page = require('../models/Page');
const BlogPost = require('../models/BlogPost');
const { getSettings, setSetting: setSiteSetting } = require('../models/Setting');

const storeLocals = require('../middleware/storeLocals');
const { requireCustomerLogin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const cart = require('../middleware/cart');
const { generateOrderNumber } = require('../middleware/helpers');
const sslcommerz = require('../lib/sslcommerz');

router.use(storeLocals);

/* =====================================================================
   HOME
   ===================================================================== */
router.get('/', async (req, res, next) => {
  try {
    const [featured, flashSale, newArrivals, categories] = await Promise.all([
      Product.find({ status: true, isFeatured: true }).sort({ createdAt: -1 }).limit(8),
      Product.find({ status: true, isFlashSale: true }).sort({ createdAt: -1 }).limit(8),
      Product.find({ status: true }).sort({ createdAt: -1 }).limit(8),
      Category.find({ status: true }).sort({ sortOrder: 1 }).limit(12),
    ]);
    res.render('index', { pageTitle: 'হোম', featured, flashSale, newArrivals, categories });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CATEGORY / PRODUCT LISTING
   ===================================================================== */
router.get(['/category', '/category/:slug'], async (req, res, next) => {
  try {
    const slug = req.params.slug || '';
    let category = null;
    if (slug) {
      category = await Category.findOne({ slug, status: true });
      if (!category) return res.status(404).render('404', { pageTitle: 'ক্যাটাগরি পাওয়া যায়নি' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 12;
    const sort = req.query.sort || 'newest';
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popular: { views: -1 },
      newest: { createdAt: -1 },
    };

    const filter = { status: true };
    if (category) filter.category = category._id;

    const [total, products, allCategories] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort(sortMap[sort] || sortMap.newest)
        .skip((page - 1) * perPage)
        .limit(perPage),
      Category.find({ status: true }).sort({ name: 1 }),
    ]);

    res.render('category', {
      pageTitle: category ? category.name : 'সকল প্রোডাক্ট',
      category,
      products,
      allCategories,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      sort,
      query: req.query,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   PRODUCT DETAIL
   ===================================================================== */
router.get('/product/:slug', async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, status: true });
    if (!product) {
      return res.status(404).render('404', { pageTitle: 'প্রোডাক্ট পাওয়া যায়নি' });
    }
    product.views += 1;
    await product.save();

    const related = await Product.find({
      category: product.category,
      _id: { $ne: product._id },
      status: true,
    }).limit(4);

    res.render('product', { pageTitle: product.name, product, related });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CART
   ===================================================================== */
router.post('/cart/action', async (req, res) => {
  const { action, productId, qty } = req.body;
  const q = parseInt(qty, 10) || 1;

  try {
    if (action === 'add') cart.cartAdd(req, productId, Math.max(1, q));
    else if (action === 'update') cart.cartSet(req, productId, Math.max(0, q));
    else if (action === 'remove') cart.cartRemove(req, productId);
    else if (action === 'clear') cart.cartClear(req);
    else return res.status(400).json({ success: false, message: 'Unknown action' });

    const details = await cart.cartDetails(req);
    const settings = await getSettings();
    const symbol = settings.currency_symbol || '৳';
    res.json({
      success: true,
      count: cart.cartCount(req),
      subtotal: details.subtotal,
      subtotalFormatted: `${symbol}${details.subtotal.toFixed(2)}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/cart', async (req, res, next) => {
  try {
    const details = await cart.cartDetails(req);
    const shippingFee = details.items.length ? Number(res.locals.settings.flat_shipping_fee || 80) : 0;
    res.render('cart', {
      pageTitle: 'শপিং কার্ট',
      items: details.items,
      subtotal: details.subtotal,
      shippingFee,
      grandTotal: details.subtotal + shippingFee,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/cart', verifyCsrf, async (req, res, next) => {
  try {
    if (req.body.updateQty) {
      const qty = req.body.qty || {};
      Object.keys(qty).forEach((productId) => {
        cart.cartSet(req, productId, Math.max(0, parseInt(qty[productId], 10) || 0));
      });
      req.flash('success', 'কার্ট আপডেট হয়েছে।');
    } else if (req.body.removeId) {
      cart.cartRemove(req, req.body.removeId);
      req.flash('success', 'প্রোডাক্ট কার্ট থেকে সরানো হয়েছে।');
    }
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CHECKOUT
   ===================================================================== */
router.get('/checkout', async (req, res, next) => {
  try {
    let items = [];
    let subtotal = 0;
    const buyNowId = req.query.buyNow;

    if (buyNowId) {
      const product = await Product.findOne({ _id: buyNowId, status: true });
      if (product) {
        const price = product.salePrice && product.salePrice < product.price ? product.salePrice : product.price;
        items = [{ product, qty: 1, price, lineTotal: price }];
        subtotal = price;
      }
    } else {
      const details = await cart.cartDetails(req);
      items = details.items;
      subtotal = details.subtotal;
    }

    if (items.length === 0) {
      req.flash('warning', 'চেকআউট করার আগে অন্তত একটি প্রোডাক্ট কার্টে যোগ করুন।');
      return res.redirect('/');
    }

    const shippingFee = Number(res.locals.settings.flat_shipping_fee || 80);
    res.render('checkout', {
      pageTitle: 'চেকআউট',
      items,
      subtotal,
      shippingFee,
      grandTotal: subtotal + shippingFee,
      buyNowId: buyNowId || null,
      errors: [],
      formData: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/checkout', async (req, res, next) => {
  try {
    if (!req.body.csrfToken || req.body.csrfToken !== req.session.csrfToken) {
      req.flash('danger', 'ফর্ম মেয়াদোত্তীর্ণ হয়েছে, আবার চেষ্টা করুন।');
      return res.redirect('/checkout');
    }

    const buyNowId = req.body.buyNowId || null;
    let items = [];
    let subtotal = 0;

    if (buyNowId) {
      const product = await Product.findOne({ _id: buyNowId, status: true });
      if (product) {
        const price = product.salePrice && product.salePrice < product.price ? product.salePrice : product.price;
        items = [{ product, qty: 1, price, lineTotal: price }];
        subtotal = price;
      }
    } else {
      const details = await cart.cartDetails(req);
      items = details.items;
      subtotal = details.subtotal;
    }

    if (items.length === 0) {
      req.flash('warning', 'আপনার কার্ট খালি।');
      return res.redirect('/');
    }

    const shippingFee = Number(res.locals.settings.flat_shipping_fee || 80);
    const grandTotal = subtotal + shippingFee;

    const { name, email, phone, address, city, notes, paymentMethod, bkashTrxId } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('নাম আবশ্যক।');
    if (!phone || !/^[0-9+\-\s]{6,20}$/.test(phone)) errors.push('সঠিক মোবাইল নম্বর দিন।');
    if (!address || !address.trim()) errors.push('ডেলিভারি ঠিকানা আবশ্যক।');
    if (!['cod', 'bkash', 'sslcommerz'].includes(paymentMethod)) errors.push('পেমেন্ট মেথড নির্বাচন করুন।');
    if (paymentMethod === 'bkash' && (!bkashTrxId || !bkashTrxId.trim())) errors.push('bKash Transaction ID আবশ্যক।');

    if (errors.length) {
      return res.render('checkout', {
        pageTitle: 'চেকআউট',
        items,
        subtotal,
        shippingFee,
        grandTotal,
        buyNowId,
        errors,
        formData: req.body,
      });
    }

    const orderNumber = generateOrderNumber();
    const paymentStatus = paymentMethod === 'cod' ? 'unpaid' : 'pending';

    const order = await Order.create({
      orderNumber,
      customer: req.session.customerId || null,
      customerName: name.trim(),
      customerEmail: (email || '').trim(),
      customerPhone: phone.trim(),
      shippingAddress: address.trim(),
      shippingCity: (city || '').trim(),
      notes: (notes || '').trim(),
      items: items.map((item) => ({
        product: item.product._id,
        productName: item.product.name,
        productImage: item.product.image,
        price: item.price,
        qty: item.qty,
        lineTotal: item.lineTotal,
      })),
      subtotal,
      shippingFee,
      total: grandTotal,
      paymentMethod,
      paymentStatus,
      transactionId: paymentMethod === 'bkash' ? bkashTrxId.trim() : null,
      status: 'pending',
    });

    // decrement stock
    await Promise.all(
      items.map((item) =>
        Product.updateOne(
          { _id: item.product._id },
          { $inc: { stock: -item.qty } }
        ).then(() => Product.updateOne({ _id: item.product._id, stock: { $lt: 0 } }, { $set: { stock: 0 } }))
      )
    );

    if (!buyNowId) {
      cart.cartClear(req);
    }

    if (paymentMethod === 'sslcommerz') {
      return res.redirect(`/payment/sslcommerz/init/${order._id}`);
    }

    res.redirect(`/order/success/${order.orderNumber}`);
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   ORDER SUCCESS / TRACKING
   ===================================================================== */
router.get('/order/success/:orderNumber', async (req, res, next) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return res.redirect('/');
    res.render('order-success', { pageTitle: 'অর্ডার সফল হয়েছে', order });
  } catch (err) {
    next(err);
  }
});

router.get('/track-order', async (req, res, next) => {
  try {
    const orderNumber = (req.query.order || '').trim();
    let order = null;
    let notFound = false;
    if (orderNumber) {
      order = await Order.findOne({ orderNumber });
      notFound = !order;
    }
    res.render('track-order', { pageTitle: 'অর্ডার ট্র্যাক করুন', order, notFound, orderNumber });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SSLCOMMERZ PAYMENT CALLBACKS
   ===================================================================== */
router.get('/payment/sslcommerz/init/:orderId', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.redirect('/');

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const response = await sslcommerz.initSession(order, baseUrl);

    if (response && response.status === 'SUCCESS' && response.GatewayPageURL) {
      return res.redirect(response.GatewayPageURL);
    }

    req.flash(
      'warning',
      'অনলাইন পেমেন্ট গেটওয়ে এই মুহূর্তে কনফিগার করা নেই (SSLCommerz sandbox/live key .env ফাইলে বসান)। আপনার অর্ডারটি "পেমেন্ট পেন্ডিং" হিসেবে সংরক্ষণ করা হয়েছে।'
    );
    res.redirect(`/order/success/${order.orderNumber}`);
  } catch (err) {
    next(err);
  }
});

router.post('/payment/sslcommerz/success', async (req, res, next) => {
  try {
    const tranId = req.body.tran_id || req.query.tran_id;
    const valId = req.body.val_id || req.query.val_id;
    const order = await Order.findOne({ orderNumber: tranId });
    if (order) {
      const valid = valId ? await sslcommerz.validateTransaction(valId) : true;
      if (valid) {
        order.paymentStatus = 'paid';
        order.transactionId = valId || tranId;
        order.status = 'processing';
        await order.save();
      }
    }
    res.redirect(`/order/success/${tranId}`);
  } catch (err) {
    next(err);
  }
});

router.post('/payment/sslcommerz/fail', async (req, res) => {
  const tranId = req.body.tran_id || req.query.tran_id;
  if (tranId) await Order.updateOne({ orderNumber: tranId }, { paymentStatus: 'failed' });
  req.flash('danger', 'পেমেন্ট ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন অথবা ক্যাশ অন ডেলিভারি ব্যবহার করুন।');
  res.redirect('/checkout');
});

router.post('/payment/sslcommerz/cancel', async (req, res) => {
  const tranId = req.body.tran_id || req.query.tran_id;
  if (tranId) await Order.updateOne({ orderNumber: tranId }, { paymentStatus: 'cancelled' });
  req.flash('warning', 'পেমেন্ট বাতিল করা হয়েছে।');
  res.redirect('/checkout');
});

router.post('/payment/sslcommerz/ipn', async (req, res) => {
  const { tran_id: tranId, val_id: valId, status } = req.body;
  if (!tranId || !valId) return res.status(400).send('Missing parameters');
  if (status === 'VALID' && (await sslcommerz.validateTransaction(valId))) {
    await Order.updateOne(
      { orderNumber: tranId },
      { paymentStatus: 'paid', transactionId: valId, status: 'processing' }
    );
    return res.status(200).send('OK');
  }
  res.status(200).send('IGNORED');
});

/* =====================================================================
   AUTH (customer)
   ===================================================================== */
router.get('/register', (req, res) => {
  if (req.session.customerId) return res.redirect('/account');
  res.render('register', { pageTitle: 'রেজিস্টার', errors: [], formData: {} });
});

router.post('/register', async (req, res, next) => {
  try {
    if (req.body.csrfToken !== req.session.csrfToken) {
      return res.render('register', { pageTitle: 'রেজিস্টার', errors: ['ফর্ম মেয়াদোত্তীর্ণ হয়েছে।'], formData: req.body });
    }
    const { name, email, phone, password, confirmPassword } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('নাম আবশ্যক।');
    if (!/^\S+@\S+\.\S+$/.test(email || '')) errors.push('সঠিক ইমেইল দিন।');
    if (!password || password.length < 6) errors.push('পাসওয়ার্ড কমপক্ষে ৬ ক্যারেক্টার হতে হবে।');
    if (password !== confirmPassword) errors.push('পাসওয়ার্ড মিলছে না।');

    if (!errors.length) {
      const existing = await Customer.findOne({ email: email.toLowerCase() });
      if (existing) {
        errors.push('এই ইমেইল দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।');
      } else {
        const hashed = await bcrypt.hash(password, 10);
        const customer = await Customer.create({ name, email: email.toLowerCase(), phone, password: hashed });
        req.session.customerId = customer._id;
        req.flash('success', 'অ্যাকাউন্ট তৈরি হয়েছে। স্বাগতম!');
        return res.redirect('/account');
      }
    }
    res.render('register', { pageTitle: 'রেজিস্টার', errors, formData: req.body });
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.session.customerId) return res.redirect('/account');
  res.render('login', { pageTitle: 'লগইন', errors: [], formData: {}, redirectTo: req.query.redirect || '/account' });
});

router.post('/login', async (req, res, next) => {
  try {
    const redirectTo = req.body.redirect || '/account';
    if (req.body.csrfToken !== req.session.csrfToken) {
      return res.render('login', { pageTitle: 'লগইন', errors: ['ফর্ম মেয়াদোত্তীর্ণ হয়েছে।'], formData: req.body, redirectTo });
    }
    const { email, password } = req.body;
    const customer = await Customer.findOne({ email: (email || '').toLowerCase() });
    if (customer && (await bcrypt.compare(password, customer.password))) {
      req.session.customerId = customer._id;
      return res.redirect(redirectTo || '/account');
    }
    res.render('login', { pageTitle: 'লগইন', errors: ['ইমেইল বা পাসওয়ার্ড সঠিক নয়।'], formData: req.body, redirectTo });
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res) => {
  delete req.session.customerId;
  res.redirect('/');
});

router.get('/account', requireCustomerLogin, async (req, res, next) => {
  try {
    const orders = await Order.find({ customer: req.session.customerId }).sort({ createdAt: -1 });
    res.render('account', { pageTitle: 'আমার অ্যাকাউন্ট', orders });
  } catch (err) {
    next(err);
  }
});

router.post('/account', requireCustomerLogin, verifyCsrf, async (req, res, next) => {
  try {
    const { name, phone, address, city } = req.body;
    await Customer.updateOne({ _id: req.session.customerId }, { name, phone, address, city });
    req.flash('success', 'প্রোফাইল আপডেট হয়েছে।');
    res.redirect('/account');
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SEARCH
   ===================================================================== */
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    let products = [];
    if (q) {
      products = await Product.find({
        status: true,
        $or: [{ name: new RegExp(q, 'i') }, { shortDescription: new RegExp(q, 'i') }],
      })
        .sort({ createdAt: -1 })
        .limit(40);
    }
    res.render('search', { pageTitle: 'সার্চ ফলাফল', q, products });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   STATIC PAGES (content is editable from Admin > পেজ ম্যানেজমেন্ট)
   ===================================================================== */
router.get('/about', async (req, res, next) => {
  try {
    const page = await Page.findOne({ key: 'about' });
    const title = page && page.title ? page.title : 'আমাদের সম্পর্কে';
    const body = page && page.body ? page.body : 'এই পেজের লেখা এখনো যোগ করা হয়নি। অ্যাডমিন প্যানেল থেকে "পেজ ম্যানেজমেন্ট" এ গিয়ে যোগ করুন।';
    res.render('policy', { pageTitle: title, title, body });
  } catch (err) {
    next(err);
  }
});

router.get('/contact', (req, res) => res.render('contact', { pageTitle: 'যোগাযোগ', sent: false }));
router.post('/contact', verifyCsrf, (req, res) => {
  // In production, send via SMTP or store in a `messages` collection.
  res.render('contact', { pageTitle: 'যোগাযোগ', sent: true });
});

const POLICY_KEYS = ['terms', 'privacy', 'refund', 'shipping', 'how-to-order', 'how-to-pay', 'faq'];
const POLICY_FALLBACK_TITLES = {
  terms: 'শর্তাবলী',
  privacy: 'প্রাইভেসি পলিসি',
  refund: 'রিফান্ড পলিসি',
  shipping: 'শিপিং পলিসি',
  'how-to-order': 'কিভাবে অর্ডার করবেন',
  'how-to-pay': 'কিভাবে পেমেন্ট করবেন',
  faq: 'সচরাচর জিজ্ঞাসিত প্রশ্ন (FAQ)',
};

router.get('/policy/:type?', async (req, res, next) => {
  try {
    const type = POLICY_KEYS.includes(req.params.type) ? req.params.type : 'terms';
    const page = await Page.findOne({ key: type });
    const title = page && page.title ? page.title : POLICY_FALLBACK_TITLES[type];
    const body = page && page.body ? page.body : 'এই পেজের লেখা এখনো যোগ করা হয়নি। অ্যাডমিন প্যানেল থেকে "পেজ ম্যানেজমেন্ট" এ গিয়ে যোগ করুন।';
    res.render('policy', { pageTitle: title, title, body });
  } catch (err) {
    next(err);
  }
});

/* Convenience aliases so nav links can use short, memorable URLs */
router.get('/how-to-order', (req, res) => res.redirect('/policy/how-to-order'));
router.get('/how-to-pay', (req, res) => res.redirect('/policy/how-to-pay'));
router.get('/faq', (req, res) => res.redirect('/policy/faq'));

/* =====================================================================
   BLOG (posts are written/edited from Admin > ব্লগ)
   ===================================================================== */
router.get('/blog', async (req, res, next) => {
  try {
    const posts = await BlogPost.find({ status: true }).sort({ createdAt: -1 });
    res.render('blog', { pageTitle: 'ব্লগ', posts });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/:slug', async (req, res, next) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, status: true });
    if (!post) {
      req.flash('danger', 'ব্লগ পোস্টটি খুঁজে পাওয়া যায়নি।');
      return res.redirect('/blog');
    }
    res.render('blog-post', { pageTitle: post.title, post });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
