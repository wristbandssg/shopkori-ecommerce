const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const SearchLog = require('../models/SearchLog');
const Page = require('../models/Page');
const CustomPage = require('../models/CustomPage');
const BlogPost = require('../models/BlogPost');
const BlogCategory = require('../models/BlogCategory');
const Vendor = require('../models/Vendor');
const VendorWalletTransaction = require('../models/VendorWalletTransaction');
const VendorWithdrawal = require('../models/VendorWithdrawal');
const VendorSubOrder = require('../models/VendorSubOrder');
const { getSettings, setSetting: setSiteSetting } = require('../models/Setting');
const { getOrderSettings } = require('../models/OrderSetting');

const storeLocals = require('../middleware/storeLocals');
const trackPageView = require('../middleware/trackPageView');
const { requireCustomerLogin, requireVendorLogin } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/csrf');
const cart = require('../middleware/cart');
const upload = require('../middleware/upload');
const { generateOrderNumber, slugify, ensureUniqueSlug } = require('../middleware/helpers');
const sslcommerz = require('../lib/sslcommerz');

router.use(storeLocals);
router.use(trackPageView);

// A product is publicly visible either because it's the platform's own
// (vendor: null — every product that existed before Vendor Ownership was
// added, and any product an Admin hasn't assigned to a vendor) or because
// it's vendor-owned AND an Admin has approved it (Product.approvalStatus
// === 'approved'). Merge this into a product `$or` visibility check
// wherever real storefront traffic browses a general listing (home,
// category, search) — see models/Product.js's `vendor`/`approvalStatus`
// fields for the full multivendor scope notes. Not retrofitted onto
// cart/checkout/buy-now product lookups (those act on a product the
// customer already added by its known _id, and touching checkout code
// for this is a separate, higher-risk change).
const PRODUCT_VISIBLE_OR = [{ vendor: null }, { approvalStatus: 'approved' }];

/* =====================================================================
   ORDER SETTING enforcement (Admin > Orders > Order Setting)
   ---------------------------------------------------------------------
   Only the cards below are backed by real, checkable data — same phone
   number, same IP, same browser session and Bangladeshi phone format —
   so only these are actually enforced here. The other cards on that page
   (VPN/Incognito/Fingerprint block, Number/IP block list, Fake Order,
   Offer Missed Order) save and display correctly but don't block
   anything yet: real VPN/device-fingerprint detection needs a paid
   third-party service, and Number/IP blocking needs a blocklist manager
   that isn't built yet.
   ===================================================================== */
async function checkOrderLimitCard(card, matchQuery, fallbackMessage) {
  if (!card || !card.status || !card.orderLimit) return null;
  const windowStart = new Date(Date.now() - (card.blockMinutes || 60) * 60000);
  const count = await Order.countDocuments({ ...matchQuery, isDeleted: false, createdAt: { $gte: windowStart } });
  if (count >= card.orderLimit) return card.message || fallbackMessage;
  return null;
}

/* =====================================================================
   Per-product delivery (Admin > Manage Product > Products > Delivery Type
   / Delivery Method) enforcement helpers.
   ===================================================================== */
const ALL_PAYMENT_METHODS = ['cod', 'bkash', 'sslcommerz'];

// One shipment, one fee: if every item in the cart is Free Shipping the
// order ships free; otherwise the fee is the highest fee any single item
// requires (a Flat Rate item's own rate, or the site's default flat fee
// for a Manual item) — that highest rate is what actually covers shipping
// the whole parcel.
function computeShippingFee(items, globalFlatFee) {
  if (!items.length) return 0;
  const fees = items.map((item) => {
    const p = item.product;
    if (p.deliveryType === 'free_shipping') return 0;
    if (p.deliveryType === 'flat_rate') return Number(p.deliveryFlatRate) || 0;
    return Number(globalFlatFee) || 0;
  });
  return Math.max(...fees);
}

// A product with no deliveryMethods set has no restriction. The cart's
// allowed methods are the intersection of every item's allowed methods.
function computeAllowedPaymentMethods(items) {
  let allowed = ALL_PAYMENT_METHODS;
  items.forEach((item) => {
    const methods = item.product.deliveryMethods;
    if (methods && methods.length) {
      allowed = allowed.filter((m) => methods.includes(m));
    }
  });
  return allowed;
}

// Resolves a buy-now line item (product + optional variant), respecting
// variantMandatory — returns null when a mandatory variant wasn't chosen.
// Starting quantity honours this product's Min Order Quantity.
function resolveBuyNowItem(product, variantId) {
  if (product.hasVariants && product.variantMandatory && !variantId) return null;
  const resolved = product.resolveVariant(variantId);
  if (!resolved) return null;
  const qty = Math.max(product.minOrderQty || 1, 1);
  return {
    product,
    variant: resolved.variant,
    variantLabel: resolved.label,
    qty,
    price: resolved.price,
    stock: resolved.stock,
    lineTotal: resolved.price * qty,
  };
}

/* =====================================================================
   FACEBOOK CATALOG FEED (Admin > Marketing > Facebook Catalog)
   ---------------------------------------------------------------------
   A live RSS/g: product feed — the format Meta Commerce Manager's "Data
   Feed" URL upload expects. Always up to date (built fresh on every
   request from the current published/in-stock catalog), regardless of
   whether the card is toggled ON — ON just means "advertise this URL";
   the URL itself works either way.
   ===================================================================== */
function xmlEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function cdata(str) {
  return `<![CDATA[${String(str == null ? '' : str).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

router.get('/feed/facebook-catalog.xml', async (req, res, next) => {
  try {
    const [products, settings] = await Promise.all([
      Product.find({ status: true }).populate('category').populate('brand').sort({ createdAt: -1 }),
      getSettings(),
    ]);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const imageUrl = (filename) => baseUrl + (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/product-placeholder.svg');

    const items = products.map((p) => {
      const hasSale = p.salePrice != null && p.salePrice < p.price;
      const availability = p.stock > 0 || p.overselling ? 'in stock' : 'out of stock';
      const link = `${baseUrl}/product/${p.slug}`;
      return (
        '<item>' +
        `<g:id>${xmlEscape(p.sku || String(p._id))}</g:id>` +
        `<title>${cdata(p.name)}</title>` +
        `<description>${cdata(p.shortDescription || p.name)}</description>` +
        `<link>${xmlEscape(link)}</link>` +
        `<g:image_link>${xmlEscape(imageUrl(p.image))}</g:image_link>` +
        `<g:availability>${availability}</g:availability>` +
        `<g:condition>${p.condition === 'used' ? 'used' : (p.condition === 'refurbished' ? 'refurbished' : 'new')}</g:condition>` +
        `<g:price>${Number(p.price).toFixed(2)} BDT</g:price>` +
        (hasSale ? `<g:sale_price>${Number(p.salePrice).toFixed(2)} BDT</g:sale_price>` : '') +
        `<g:brand>${cdata(p.brand ? p.brand.name : settings.site_name)}</g:brand>` +
        (p.category ? `<g:product_type>${cdata(p.category.name)}</g:product_type>` : '') +
        '</item>'
      );
    }).join('');

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">' +
      '<channel>' +
      `<title>${cdata(settings.site_name + ' Product Catalog')}</title>` +
      `<link>${xmlEscape(baseUrl)}</link>` +
      `<description>${cdata('Live product feed for ' + settings.site_name)}</description>` +
      items +
      '</channel>' +
      '</rss>';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   SITEMAP.XML
   ---------------------------------------------------------------------
   A live XML sitemap, built fresh from the current published catalog +
   content every time it's requested (same "always current" approach as
   the Facebook catalog feed above) — no separate generate/regenerate
   step for the admin to remember. Includes: home, static pages (About +
   policy pages), Page Builder pages, category & brand listing pages,
   published products, and the blog (listing + published posts).
   ===================================================================== */
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const urlEntry = (loc, opts) => {
      opts = opts || {};
      return (
        '<url>' +
        `<loc>${xmlEscape(loc)}</loc>` +
        (opts.lastmod ? `<lastmod>${new Date(opts.lastmod).toISOString()}</lastmod>` : '') +
        (opts.changefreq ? `<changefreq>${opts.changefreq}</changefreq>` : '') +
        (opts.priority ? `<priority>${opts.priority}</priority>` : '') +
        '</url>'
      );
    };

    const [categories, brands, products, blogPosts, staticPages, customPages, blogCategories] = await Promise.all([
      Category.find({ status: true }),
      Brand.find({ status: true }),
      Product.find({ status: true }).select('slug updatedAt'),
      BlogPost.find({ status: true }).select('slug updatedAt'),
      Page.find({}),
      CustomPage.find({ status: true }).select('slug updatedAt'),
      BlogCategory.find({ status: true }).select('slug updatedAt'),
    ]);

    const entries = [];
    entries.push(urlEntry(`${baseUrl}/`, { changefreq: 'daily', priority: '1.0' }));
    entries.push(urlEntry(`${baseUrl}/blog`, { changefreq: 'daily', priority: '0.6' }));

    staticPages.forEach((p) => {
      const loc = p.key === 'about' ? `${baseUrl}/about` : `${baseUrl}/policy/${p.key}`;
      entries.push(urlEntry(loc, { lastmod: p.updatedAt, changefreq: 'monthly', priority: '0.4' }));
    });
    customPages.forEach((p) => {
      entries.push(urlEntry(`${baseUrl}/page/${p.slug}`, { lastmod: p.updatedAt, changefreq: 'monthly', priority: '0.4' }));
    });
    categories.forEach((c) => {
      entries.push(urlEntry(`${baseUrl}/category/${c.slug}`, { changefreq: 'daily', priority: '0.7' }));
    });
    brands.forEach((b) => {
      entries.push(urlEntry(`${baseUrl}/brand/${b.slug}`, { changefreq: 'daily', priority: '0.6' }));
    });
    products.forEach((p) => {
      entries.push(urlEntry(`${baseUrl}/product/${p.slug}`, { lastmod: p.updatedAt, changefreq: 'weekly', priority: '0.8' }));
    });
    blogCategories.forEach((c) => {
      entries.push(urlEntry(`${baseUrl}/blog/category/${c.slug}`, { lastmod: c.updatedAt, changefreq: 'weekly', priority: '0.5' }));
    });
    blogPosts.forEach((p) => {
      entries.push(urlEntry(`${baseUrl}/blog/${p.slug}`, { lastmod: p.updatedAt, changefreq: 'monthly', priority: '0.5' }));
    });

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      entries.join('') +
      '</urlset>';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

router.get('/robots.txt', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(`User-agent: *\nDisallow: /admin\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

/* =====================================================================
   HOME
   ===================================================================== */
router.get('/', async (req, res, next) => {
  try {
    // A vendor-owned product only shows here once approved (see
    // PRODUCT_VISIBLE_OR, top of this file) — a platform product
    // (vendor: null) is unaffected, exactly as before this field existed.
    const [featured, flashSale, newArrivals, categories] = await Promise.all([
      Product.find({ status: true, isFeatured: true, $or: PRODUCT_VISIBLE_OR }).sort({ createdAt: -1 }).limit(8),
      Product.find({ status: true, isFlashSale: true, $or: PRODUCT_VISIBLE_OR }).sort({ createdAt: -1 }).limit(8),
      Product.find({ status: true, $or: PRODUCT_VISIBLE_OR }).sort({ createdAt: -1 }).limit(8),
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
    // Match a product listed under this category either as its primary
    // category, or as one of its additional/secondary categories — combined
    // with PRODUCT_VISIBLE_OR via $and rather than a second top-level $or
    // key, since Mongo would otherwise just let the second $or overwrite
    // the first.
    if (category) {
      filter.$and = [
        { $or: [{ category: category._id }, { categories: category._id }] },
        { $or: PRODUCT_VISIBLE_OR },
      ];
    } else {
      filter.$or = PRODUCT_VISIBLE_OR;
    }

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
      metaTitle: category ? category.metaTitle : '',
      metaKeywords: category ? category.metaKeywords : '',
      metaDescription: category ? category.metaDescription : '',
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   BRAND LISTING (same shape as CATEGORY / PRODUCT LISTING above, so a
   brand page reads, sorts and ranks the same way a category page does)
   ===================================================================== */
router.get('/brand/:slug', async (req, res, next) => {
  try {
    const brand = await Brand.findOne({ slug: req.params.slug, status: true });
    if (!brand) return res.status(404).render('404', { pageTitle: 'ব্র্যান্ড পাওয়া যায়নি' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 12;
    const sort = req.query.sort || 'newest';
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      popular: { views: -1 },
      newest: { createdAt: -1 },
    };
    const filter = { status: true, brand: brand._id };

    const [total, products, allBrands] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort(sortMap[sort] || sortMap.newest)
        .skip((page - 1) * perPage)
        .limit(perPage),
      Brand.find({ status: true }).sort({ sortOrder: 1, name: 1 }),
    ]);

    res.render('brand', {
      pageTitle: brand.pageTitle || brand.name,
      brand,
      products,
      allBrands,
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      sort,
      query: req.query,
      metaTitle: brand.metaTitle,
      metaKeywords: brand.metaKeywords,
      metaDescription: brand.metaDescription,
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
    const product = await Product.findOne({ slug: req.params.slug, status: true })
      .populate('category')
      .populate('brand');
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

    res.render('product', {
      pageTitle: product.name,
      product,
      related,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      metaKeywords: product.metaKeywords,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   CART
   ===================================================================== */
router.post('/cart/action', async (req, res) => {
  const { action, productId, qty, variantId } = req.body;
  const q = parseInt(qty, 10) || 1;

  try {
    if (action === 'add') {
      const product = await Product.findOne({ _id: productId, status: true });
      if (!product) return res.status(400).json({ success: false, message: 'প্রোডাক্টটি পাওয়া যায়নি।' });
      if (product.hasVariants && product.variantMandatory && !variantId) {
        return res.status(400).json({ success: false, message: 'দয়া করে একটি ভ্যারিয়েন্ট নির্বাচন করুন।' });
      }
      if (variantId && !product.variants.id(variantId)) {
        return res.status(400).json({ success: false, message: 'ভ্যারিয়েন্টটি পাওয়া যায়নি।' });
      }
      // Clamp to this product's Min/Max Order Quantity (Admin > Products).
      let clampedQty = Math.max(product.minOrderQty || 1, q);
      if (product.maxOrderQty) clampedQty = Math.min(clampedQty, product.maxOrderQty);
      cart.cartAdd(req, productId, clampedQty, variantId || null);
    } else if (action === 'update') cart.cartSet(req, productId, Math.max(0, q), variantId || null);
    else if (action === 'remove') cart.cartRemove(req, productId, variantId || null);
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
      Object.keys(qty).forEach((key) => {
        const { productId, variantId } = cart.parseKey(key);
        cart.cartSet(req, productId, Math.max(0, parseInt(qty[key], 10) || 0), variantId);
      });
      req.flash('success', 'কার্ট আপডেট হয়েছে।');
    } else if (req.body.removeId) {
      const { productId, variantId } = cart.parseKey(req.body.removeId);
      cart.cartRemove(req, productId, variantId);
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
    const buyNowVariantId = req.query.variant || '';

    if (buyNowId) {
      const product = await Product.findOne({ _id: buyNowId, status: true });
      if (product) {
        const item = resolveBuyNowItem(product, buyNowVariantId);
        if (item) {
          items = [item];
          subtotal = item.lineTotal;
        }
      }
    } else {
      const details = await cart.cartDetails(req);
      items = details.items;
      subtotal = details.subtotal;
    }

    if (items.length === 0) {
      req.flash('warning', 'চেকআউট করার আগে অন্তত একটি প্রোডাক্ট কার্টে যোগ করুন (অথবা প্রোডাক্ট পেজে ফিরে গিয়ে ভ্যারিয়েন্ট নির্বাচন করুন)।');
      return res.redirect('/');
    }

    const shippingFee = computeShippingFee(items, res.locals.settings.flat_shipping_fee || 80);
    const allowedMethods = computeAllowedPaymentMethods(items);
    res.render('checkout', {
      pageTitle: 'চেকআউট',
      items,
      subtotal,
      shippingFee,
      grandTotal: subtotal + shippingFee,
      buyNowId: buyNowId || null,
      buyNowVariantId,
      allowedMethods,
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
    const buyNowVariantId = req.body.buyNowVariantId || '';
    let items = [];
    let subtotal = 0;

    if (buyNowId) {
      const product = await Product.findOne({ _id: buyNowId, status: true });
      if (product) {
        const item = resolveBuyNowItem(product, buyNowVariantId);
        if (item) {
          items = [item];
          subtotal = item.lineTotal;
        }
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

    const shippingFee = computeShippingFee(items, res.locals.settings.flat_shipping_fee || 80);
    const allowedMethods = computeAllowedPaymentMethods(items);
    const grandTotal = subtotal + shippingFee;

    const { name, email, phone, address, city, notes, paymentMethod, bkashTrxId } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('নাম আবশ্যক।');
    if (!phone || !/^[0-9+\-\s]{6,20}$/.test(phone)) errors.push('সঠিক মোবাইল নম্বর দিন।');
    if (!address || !address.trim()) errors.push('ডেলিভারি ঠিকানা আবশ্যক।');
    if (!['cod', 'bkash', 'sslcommerz'].includes(paymentMethod)) errors.push('পেমেন্ট মেথড নির্বাচন করুন।');
    else if (!allowedMethods.includes(paymentMethod)) errors.push('এই প্রোডাক্ট(গুলো)-র জন্য এই পেমেন্ট মেথডটি সমর্থিত নয়। অনুগ্রহ করে অন্য একটি মেথড বেছে নিন।');
    if (paymentMethod === 'bkash' && (!bkashTrxId || !bkashTrxId.trim())) errors.push('bKash Transaction ID আবশ্যক।');
    items.forEach((item) => {
      const label = item.variantLabel ? `${item.product.name} (${item.variantLabel})` : item.product.name;
      if (!item.product.overselling && item.qty > item.stock) {
        errors.push(`${label} — পর্যাপ্ত স্টক নেই (আছে ${item.stock} টি)।`);
      }
      const minQty = item.product.minOrderQty || 1;
      const maxQty = item.product.maxOrderQty;
      if (item.qty < minQty) {
        errors.push(`${label} — সর্বনিম্ন ${minQty} টি অর্ডার করতে হবে।`);
      } else if (maxQty && item.qty > maxQty) {
        errors.push(`${label} — সর্বোচ্চ ${maxQty} টি অর্ডার করা যাবে।`);
      }
    });

    // Order Setting enforcement (see block comment above router.use(storeLocals)).
    const orderSettings = await getOrderSettings();
    const clientIp = req.ip || '';
    const trackToken = req.sessionID || '';
    if (!errors.length) {
      if (orderSettings.numberValidation.status && phone && !/^01[3-9]\d{8}$/.test(phone.trim())) {
        errors.push(orderSettings.numberValidation.message || 'অনুগ্রহ করে একটি সঠিক ও সচল মোবাইল নম্বর প্রদান করুন।');
      }
      if (!errors.length && phone) {
        const numberMsg = await checkOrderLimitCard(
          orderSettings.sameNumberLimit,
          { customerPhone: phone.trim() },
          'এই মোবাইল নম্বর দিয়ে নির্ধারিত সংখ্যার বেশি অর্ডার করা সম্ভব নয়।'
        );
        if (numberMsg) errors.push(numberMsg);
      }
      if (!errors.length && clientIp) {
        const ipMsg = await checkOrderLimitCard(
          orderSettings.sameIpLimit,
          { ip: clientIp },
          'এই IP ঠিকানা থেকে নির্ধারিত সংখ্যার বেশি অর্ডার করা সম্ভব নয়।'
        );
        if (ipMsg) errors.push(ipMsg);
      }
      if (!errors.length && trackToken) {
        const cookieMsg = await checkOrderLimitCard(
          orderSettings.cookiesLimit,
          { trackToken },
          'এই ব্রাউজার থেকে নির্ধারিত সংখ্যার বেশি অর্ডার করা সম্ভব নয়।'
        );
        if (cookieMsg) errors.push(cookieMsg);
      }
    }

    if (errors.length) {
      return res.render('checkout', {
        pageTitle: 'চেকআউট',
        items,
        subtotal,
        shippingFee,
        grandTotal,
        buyNowId,
        buyNowVariantId,
        allowedMethods,
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
        productName: item.variantLabel ? `${item.product.name} (${item.variantLabel})` : item.product.name,
        productImage: item.product.image,
        variantId: item.variant ? item.variant._id : null,
        variantLabel: item.variantLabel || '',
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
      ip: clientIp,
      trackToken,
    });

    // Parent Order + Vendor Sub-order (multivendor Phase 2): split this
    // order's items by product.vendor into one VendorSubOrder per vendor
    // involved. Nothing is credited to any wallet yet — that only happens
    // once an Admin marks the order 'delivered' (see applyStatusChange() /
    // settleVendorSubOrders() in routes/admin.js). Wrapped so a problem
    // here never breaks checkout itself — the order the customer sees has
    // already been created and stock already reserved by this point.
    try {
      const byVendor = new Map();
      items.forEach((item) => {
        const vendorId = item.product.vendor ? String(item.product.vendor) : null;
        if (!vendorId) return;
        if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
        byVendor.get(vendorId).push(item);
      });
      if (byVendor.size) {
        const vendorDocs = await Vendor.find({ _id: { $in: [...byVendor.keys()] } }).select('commissionPercent');
        const vendorMap = new Map(vendorDocs.map((v) => [String(v._id), v]));
        await Promise.all(
          [...byVendor.entries()].map(([vendorId, vItems]) => {
            const vendor = vendorMap.get(vendorId);
            if (!vendor) return null; // vendor was deleted between product-assignment and checkout — skip rather than crash
            const vSubtotal = vItems.reduce((sum, i) => sum + i.lineTotal, 0);
            const commissionPercent = vendor.commissionPercent || 0;
            const commissionAmount = Math.round(vSubtotal * (commissionPercent / 100) * 100) / 100;
            const vendorEarning = Math.round((vSubtotal - commissionAmount) * 100) / 100;
            return VendorSubOrder.create({
              parentOrder: order._id,
              orderNumber: order.orderNumber,
              vendor: vendorId,
              items: vItems.map((i) => ({
                product: i.product._id,
                productName: i.variantLabel ? `${i.product.name} (${i.variantLabel})` : i.product.name,
                qty: i.qty,
                lineTotal: i.lineTotal,
              })),
              subtotal: vSubtotal,
              commissionPercent,
              commissionAmount,
              vendorEarning,
            });
          })
        );
      }
    } catch (subOrderErr) {
      console.error('[vendor-sub-order] failed to create sub-order(s) for order', order.orderNumber, subOrderErr);
    }

    // Decrement stock — the variant's own stock when one was picked,
    // otherwise the product's base stock. When overselling is on for that
    // product, skip the clamp-to-zero step so it can legitimately go
    // negative (a visible backorder count) instead of being blocked.
    await Promise.all(
      items.map((item) => {
        if (item.variant) {
          const p = Product.updateOne(
            { _id: item.product._id, 'variants._id': item.variant._id },
            { $inc: { 'variants.$.stock': -item.qty } }
          );
          if (item.product.overselling) return p;
          return p.then(() =>
            Product.updateOne(
              { _id: item.product._id, 'variants._id': item.variant._id, 'variants.$.stock': { $lt: 0 } },
              { $set: { 'variants.$.stock': 0 } }
            )
          );
        }
        const p = Product.updateOne({ _id: item.product._id }, { $inc: { stock: -item.qty } });
        if (item.product.overselling) return p;
        return p.then(() => Product.updateOne({ _id: item.product._id, stock: { $lt: 0 } }, { $set: { stock: 0 } }));
      })
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

    // After Confirm Products (Admin > Products > a product's After Confirm
    // Products section): show upsell products configured on any product
    // that was just ordered, using each product's current settings.
    const orderedProductIds = order.items.map((i) => i.product).filter(Boolean);
    const orderedProducts = orderedProductIds.length
      ? await Product.find({ _id: { $in: orderedProductIds } })
      : [];
    const upsellIds = new Set();
    let offerText = '';
    orderedProducts.forEach((p) => {
      if (p.afterConfirmEnabled && p.afterConfirmProducts && p.afterConfirmProducts.length) {
        p.afterConfirmProducts.forEach((id) => upsellIds.add(String(id)));
        if (p.afterConfirmOfferDescription) offerText = p.afterConfirmOfferDescription;
      }
    });
    const upsellProducts = upsellIds.size
      ? await Product.find({ _id: { $in: [...upsellIds] }, status: true })
      : [];

    res.render('order-success', { pageTitle: 'অর্ডার সফল হয়েছে', order, upsellProducts, offerText });
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
        // Admin > Referral Program: credit whichever admin's share link
        // brought this visitor here (captured in middleware/storeLocals.js).
        const customer = await Customer.create({
          name, email: email.toLowerCase(), phone, password: hashed,
          referredBy: req.session.referralAdminId || null,
        });
        delete req.session.referralAdminId;
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
   VENDOR — self-registration, KYC, login, dashboard, wallet, store page.
   Session-based auth, same convention as Customer above (req.session.
   vendorId instead of customerId). See models/Vendor.js for the account
   shape and honest scope notes.
   ===================================================================== */
router.get('/vendor/register', (req, res) => {
  if (req.session.vendorId) return res.redirect('/vendor/dashboard');
  res.render('vendor-register', { pageTitle: 'ভেন্ডর হিসেবে যুক্ত হন', errors: [] });
});

router.post('/vendor/register', async (req, res, next) => {
  try {
    const { ownerName, storeName, email, phone, password, confirmPassword, address } = req.body;
    const errors = [];
    if (!ownerName || !ownerName.trim()) errors.push('আপনার নাম দিন।');
    if (!storeName || !storeName.trim()) errors.push('দোকানের নাম দিন।');
    if (!email || !email.trim()) errors.push('ইমেইল দিন।');
    if (!password || password.length < 6) errors.push('পাসওয়ার্ড কমপক্ষে ৬ ক্যারেক্টার হতে হবে।');
    if (password !== confirmPassword) errors.push('পাসওয়ার্ড দুটি মিলছে না।');

    if (!errors.length) {
      const existing = await Vendor.findOne({ email: (email || '').trim().toLowerCase() });
      if (existing) errors.push('এই ইমেইল দিয়ে আগে থেকেই একটি ভেন্ডর অ্যাকাউন্ট আছে।');
    }

    if (errors.length) {
      return res.render('vendor-register', { pageTitle: 'ভেন্ডর হিসেবে যুক্ত হন', errors, formData: req.body });
    }

    const settings = await getSettings();
    const hashed = await bcrypt.hash(password, 10);
    const slug = await ensureUniqueSlug(Vendor, slugify(storeName), null);
    const vendor = await Vendor.create({
      ownerName: ownerName.trim(),
      storeName: storeName.trim(),
      slug,
      email: email.trim().toLowerCase(),
      phone: (phone || '').trim(),
      address: (address || '').trim(),
      password: hashed,
      commissionPercent: Number(settings.vendor_default_commission_percent) || 10,
    });
    req.session.vendorId = vendor._id;
    req.flash('success', 'আপনার ভেন্ডর অ্যাকাউন্ট তৈরি হয়েছে। এখন আপনার KYC ডকুমেন্ট জমা দিন — অ্যাডমিন অনুমোদন করলে আপনার দোকান লাইভ হবে।');
    res.redirect('/vendor/kyc');
  } catch (err) {
    next(err);
  }
});

router.get('/vendor/login', (req, res) => {
  if (req.session.vendorId) return res.redirect('/vendor/dashboard');
  res.render('vendor-login', { pageTitle: 'ভেন্ডর লগইন', error: null });
});

router.post('/vendor/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const vendor = await Vendor.findOne({ email: (email || '').trim().toLowerCase() });
    if (vendor && (await bcrypt.compare(password || '', vendor.password))) {
      req.session.vendorId = vendor._id;
      return res.redirect('/vendor/dashboard');
    }
    res.render('vendor-login', { pageTitle: 'ভেন্ডর লগইন', error: 'ইমেইল অথবা পাসওয়ার্ড ভুল।' });
  } catch (err) {
    next(err);
  }
});

router.get('/vendor/logout', (req, res) => {
  delete req.session.vendorId;
  res.redirect('/vendor/login');
});

router.get('/vendor/dashboard', requireVendorLogin, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    const productCount = await Product.countDocuments({ vendor: vendor._id });
    res.render('vendor-dashboard', { pageTitle: 'ভেন্ডর ড্যাশবোর্ড', vendor, productCount });
  } catch (err) {
    next(err);
  }
});

router.get('/vendor/kyc', requireVendorLogin, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    res.render('vendor-kyc', { pageTitle: 'KYC ভেরিফিকেশন', vendor, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/vendor/kyc',
  requireVendorLogin,
  upload.fields([{ name: 'nidDocument', maxCount: 1 }, { name: 'tradeLicenseDocument', maxCount: 1 }]),
  verifyCsrf,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.session.vendorId);
      if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }

      const {
        nidNumber, tradeLicenseNumber,
        bankAccountName, bankAccountNumber, bankName,
      } = req.body;
      const errors = [];
      if (!nidNumber || !nidNumber.trim()) errors.push('NID নম্বর দিন।');
      const files = req.files || {};
      const nidFile = files.nidDocument && files.nidDocument[0];
      const tradeFile = files.tradeLicenseDocument && files.tradeLicenseDocument[0];
      if (!nidFile && !vendor.kyc.nidDocument) errors.push('NID-এর ছবি আপলোড করুন।');

      if (errors.length) {
        return res.render('vendor-kyc', { pageTitle: 'KYC ভেরিফিকেশন', vendor, errors });
      }

      vendor.kyc = {
        nidNumber: (nidNumber || '').trim(),
        nidDocument: nidFile ? nidFile.filename : vendor.kyc.nidDocument,
        tradeLicenseNumber: (tradeLicenseNumber || '').trim(),
        tradeLicenseDocument: tradeFile ? tradeFile.filename : vendor.kyc.tradeLicenseDocument,
        bankAccountName: (bankAccountName || '').trim(),
        bankAccountNumber: (bankAccountNumber || '').trim(),
        bankName: (bankName || '').trim(),
        submittedAt: new Date(),
      };
      // Re-submitting after a rejection puts it back in the review queue.
      vendor.kycStatus = 'pending';
      vendor.kycRejectionReason = '';
      await vendor.save();
      req.flash('success', 'আপনার KYC তথ্য জমা হয়েছে। অ্যাডমিন যাচাই করার পর জানানো হবে।');
      res.redirect('/vendor/dashboard');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/vendor/profile', requireVendorLogin, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    res.render('vendor-profile', { pageTitle: 'দোকানের তথ্য', vendor, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/vendor/profile',
  requireVendorLogin,
  upload.fields([{ name: 'storeLogo', maxCount: 1 }, { name: 'storeBanner', maxCount: 1 }]),
  verifyCsrf,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.session.vendorId);
      if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
      const { ownerName, storeName, phone, address, storeDescription } = req.body;
      if (!storeName || !storeName.trim()) {
        return res.render('vendor-profile', { pageTitle: 'দোকানের তথ্য', vendor, errors: ['দোকানের নাম দিন।'] });
      }
      const files = req.files || {};
      vendor.ownerName = (ownerName || vendor.ownerName).trim();
      vendor.storeName = storeName.trim();
      vendor.phone = (phone || '').trim();
      vendor.address = (address || '').trim();
      vendor.storeDescription = (storeDescription || '').trim();
      if (files.storeLogo && files.storeLogo[0]) vendor.storeLogo = files.storeLogo[0].filename;
      if (files.storeBanner && files.storeBanner[0]) vendor.storeBanner = files.storeBanner[0].filename;
      await vendor.save();
      req.flash('success', 'দোকানের তথ্য আপডেট হয়েছে।');
      res.redirect('/vendor/profile');
    } catch (err) {
      next(err);
    }
  }
);

router.get('/vendor/wallet', requireVendorLogin, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    const [transactions, withdrawals] = await Promise.all([
      VendorWalletTransaction.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(100),
      VendorWithdrawal.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(50),
    ]);
    res.render('vendor-wallet', { pageTitle: 'ওয়ালেট', vendor, transactions, withdrawals, errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/vendor/wallet/withdraw', requireVendorLogin, verifyCsrf, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    const { amount, method, methodDetails, note } = req.body;
    const amountNum = parseFloat(amount);
    const errors = [];
    if (!amountNum || amountNum <= 0) errors.push('সঠিক পরিমাণ দিন।');
    else if (amountNum > vendor.walletBalance) errors.push('আপনার ওয়ালেট ব্যালেন্সের চেয়ে বেশি টাকা উত্তোলন করা যাবে না।');
    if (!['bkash', 'nagad', 'bank'].includes(method)) errors.push('পেমেন্ট মেথড নির্বাচন করুন।');

    if (errors.length) {
      const [transactions, withdrawals] = await Promise.all([
        VendorWalletTransaction.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(100),
        VendorWithdrawal.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(50),
      ]);
      return res.render('vendor-wallet', { pageTitle: 'ওয়ালেট', vendor, transactions, withdrawals, errors });
    }

    await VendorWithdrawal.create({
      vendor: vendor._id,
      amount: amountNum,
      method,
      methodDetails: (methodDetails || '').trim(),
      note: (note || '').trim(),
    });
    req.flash('success', 'উত্তোলনের অনুরোধ পাঠানো হয়েছে। অ্যাডমিন অনুমোদন করলে টাকা কেটে নেওয়া হবে।');
    res.redirect('/vendor/wallet');
  } catch (err) {
    next(err);
  }
});

// Vendor Sub-orders (multivendor Phase 2) — a vendor's own view of which
// orders included their products, and each one's settlement status. See
// models/VendorSubOrder.js for the full settlement/return scope notes.
router.get('/vendor/orders', requireVendorLogin, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    const subOrders = await VendorSubOrder.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(100);
    res.render('vendor-orders', { pageTitle: 'অর্ডার', vendor, subOrders });
  } catch (err) {
    next(err);
  }
});

router.post('/vendor/orders/:id/dispute', requireVendorLogin, verifyCsrf, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.session.vendorId);
    if (!vendor) { delete req.session.vendorId; return res.redirect('/vendor/login'); }
    const subOrder = await VendorSubOrder.findOne({ _id: req.params.id, vendor: vendor._id });
    if (!subOrder) {
      req.flash('danger', 'অর্ডার পাওয়া যায়নি।');
      return res.redirect('/vendor/orders');
    }
    // Only a reversed (refunded/returned) sub-order can be disputed — a
    // pending or settled one has nothing to contest yet.
    if (subOrder.settlementStatus === 'reversed' && subOrder.disputeStatus === 'none') {
      const note = (req.body.disputeNote || '').trim();
      if (note) {
        subOrder.disputeStatus = 'vendor_disputed';
        subOrder.disputeNote = note;
        await subOrder.save();
        req.flash('success', 'আপনার আপত্তি অ্যাডমিনের কাছে পাঠানো হয়েছে।');
      } else {
        req.flash('danger', 'কারণ লিখুন।');
      }
    }
    res.redirect('/vendor/orders');
  } catch (err) {
    next(err);
  }
});

/* Public vendor store page — only an 'active' vendor's page resolves;
   a pending/suspended/rejected vendor's slug 404s, same convention as
   an unpublished product/category/blog post elsewhere in this file. */
router.get('/store/:slug', async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ slug: req.params.slug, accountStatus: 'active' });
    if (!vendor) return res.status(404).render('404', { pageTitle: 'দোকান পাওয়া যায়নি' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 12;
    const filter = { vendor: vendor._id, status: true, approvalStatus: 'approved' };
    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage),
    ]);

    res.render('vendor-store', {
      pageTitle: vendor.storeName,
      vendor, products, total, page, perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    });
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
        $and: [
          { $or: [{ name: new RegExp(q, 'i') }, { shortDescription: new RegExp(q, 'i') }, { tags: new RegExp(q, 'i') }] },
          { $or: PRODUCT_VISIBLE_OR },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(40);
      // Admin > Analytics > Search Analytics — fire-and-forget, same
      // pattern as middleware/trackPageView.js, so a slow/failed write
      // here never delays real search results.
      SearchLog.create({
        query: q,
        resultCount: products.length,
        sessionKey: (req.session && req.session.id) || '',
        customer: req.session.customerId || null,
      }).catch(() => {});
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
    res.render('policy', {
      pageTitle: title, title, body,
      image: page ? page.image : null,
      imageAlt: page ? page.imageAlt : '',
      metaTitle: page ? page.metaTitle : '',
      metaKeywords: page ? page.metaKeywords : '',
      metaDescription: page ? page.metaDescription : '',
    });
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
    res.render('policy', {
      pageTitle: title, title, body,
      image: page ? page.image : null,
      imageAlt: page ? page.imageAlt : '',
      metaTitle: page ? page.metaTitle : '',
      metaKeywords: page ? page.metaKeywords : '',
      metaDescription: page ? page.metaDescription : '',
    });
  } catch (err) {
    next(err);
  }
});

/* Convenience aliases so nav links can use short, memorable URLs */
router.get('/how-to-order', (req, res) => res.redirect('/policy/how-to-order'));
router.get('/how-to-pay', (req, res) => res.redirect('/policy/how-to-pay'));
router.get('/faq', (req, res) => res.redirect('/policy/faq'));

/* =====================================================================
   PAGE BUILDER PAGES (Admin > Settings > Page Builder) — arbitrary pages
   an admin creates at any slug. Previously these could be created and
   edited in the admin panel but had NO storefront route at all, so a
   newly-created page never actually appeared anywhere on the live site —
   this route is what makes "create a new page" actually work end to end.
   ===================================================================== */
router.get('/page/:slug', async (req, res, next) => {
  try {
    const page = await CustomPage.findOne({ slug: req.params.slug, status: true });
    if (!page) {
      return res.status(404).render('404', { pageTitle: 'পেজ পাওয়া যায়নি' });
    }
    res.render('page', {
      pageTitle: page.title,
      page,
      metaTitle: page.metaTitle,
      metaKeywords: page.metaKeywords,
      metaDescription: page.metaDescription,
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
   BLOG (posts are written/edited from Admin > ব্লগ)
   ---------------------------------------------------------------------
   Categories are a real collection now (models/BlogCategory.js, managed
   from Admin > Blog > Categories) — same shape as Product Category — so
   /blog/category/:slug is registered BEFORE /blog/:slug below (otherwise
   the :slug wildcard would swallow it and try to look up a blog post
   literally named "category").
   ===================================================================== */
router.get('/blog', async (req, res, next) => {
  try {
    const { tag } = req.query;
    const filter = { status: true };
    if (tag) filter.tags = tag;
    const posts = await BlogPost.find(filter).populate('category').sort({ createdAt: -1 });
    const blogCategories = await BlogCategory.find({ status: true }).sort({ sortOrder: 1, name: 1 });
    const tagsRaw = await BlogPost.distinct('tags', { status: true });
    const tags = tagsRaw.filter(Boolean).sort();
    res.render('blog', {
      pageTitle: 'ব্লগ', posts, blogCategories, tags, activeTag: tag || '',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/category/:slug', async (req, res, next) => {
  try {
    const category = await BlogCategory.findOne({ slug: req.params.slug, status: true });
    if (!category) return res.status(404).render('404', { pageTitle: 'ক্যাটাগরি পাওয়া যায়নি' });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 9;
    const filter = { status: true, category: category._id };
    const [total, posts, allBlogCategories] = await Promise.all([
      BlogPost.countDocuments(filter),
      BlogPost.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage),
      BlogCategory.find({ status: true }).sort({ sortOrder: 1, name: 1 }),
    ]);

    res.render('blog-category', {
      pageTitle: category.pageTitle || category.name,
      category, posts, allBlogCategories, total, page, perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      metaTitle: category.metaTitle,
      metaKeywords: category.metaKeywords,
      metaDescription: category.metaDescription,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/blog/:slug', async (req, res, next) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, status: true }).populate('category');
    if (!post) {
      req.flash('danger', 'ব্লগ পোস্টটি খুঁজে পাওয়া যায়নি।');
      return res.redirect('/blog');
    }
    const orConditions = [
      ...(post.category ? [{ category: post.category._id }] : []),
      ...(post.tags && post.tags.length ? [{ tags: { $in: post.tags } }] : []),
    ];
    const relatedPosts = orConditions.length
      ? await BlogPost.find({ status: true, _id: { $ne: post._id }, $or: orConditions }).limit(3)
      : [];
    res.render('blog-post', {
      pageTitle: post.title, post, relatedPosts,
      metaTitle: post.metaTitle,
      metaKeywords: post.metaKeywords,
      metaDescription: post.metaDescription,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
