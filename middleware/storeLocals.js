const Category = require('../models/Category');
const Customer = require('../models/Customer');
const Admin = require('../models/Admin');
const Announcement = require('../models/Announcement');
const { getSettings } = require('../models/Setting');
const { getMarketingSettings } = require('../models/MarketingSetting');
const { getThemeCustomizer } = require('../models/ThemeCustomizer');
const { getOfferSetting } = require('../models/OfferSetting');
const { currencyFormatter, nl2br, renderRichText } = require('./helpers');
const { cartCount } = require('./cart');

/**
 * Populates res.locals with everything the storefront header/footer views need:
 * settings, currency formatter, nav categories, cart count, and the logged-in customer.
 * Mirrors what includes/header.php did on every PHP page load.
 */
async function storeLocals(req, res, next) {
  try {
    const [settings, allCategories, marketing, themeCustomizer, offerSettings, storeAnnouncements] = await Promise.all([
      getSettings(),
      Category.find({ status: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      getMarketingSettings(),
      getThemeCustomizer(),
      getOfferSetting(),
      // Admin > Announcement System (audience: 'customers') — a real
      // dismissible banner on the storefront, see views/partials/header.ejs.
      Announcement.find({
        audience: 'customers',
        active: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    // Build a 2-level tree (parent -> children) so the header can render a
    // giftallbd.com-style mega menu: each top-level category's subcategories
    // show up as columns/items in its flyout panel.
    const childrenByParent = {};
    allCategories.forEach(function (cat) {
      if (cat.parent) {
        const key = String(cat.parent);
        (childrenByParent[key] = childrenByParent[key] || []).push(cat);
      }
    });
    const navCategories = allCategories
      .filter(function (cat) { return !cat.parent; })
      .map(function (cat) {
        return Object.assign({}, cat, { children: childrenByParent[String(cat._id)] || [] });
      });

    res.locals.settings = settings;
    // Admin > Marketing (see views/partials/header.ejs for what each ON
    // card actually injects into the page).
    res.locals.marketing = marketing;
    // Admin > Customization > Advance Theme Setup (see views/partials/header.ejs
    // for the <style> block this drives).
    res.locals.themeCustomizer = themeCustomizer;
    // Admin > Offer Setting (see views/index.ejs for the homepage sections
    // this gates, and views/partials/header.ejs for the popup).
    res.locals.offerSettings = offerSettings;
    res.locals.currency = currencyFormatter(settings.currency_symbol || '৳');
    // Absolute site URL, used to build canonical links and the absolute
    // URLs schema.org JSON-LD structured data requires (Organization/WebSite
    // on every page, Product/BreadcrumbList on product & category pages).
    res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
    // req itself isn't passed to EJS views, so the current path is exposed
    // separately for the canonical <link> tag (header.ejs).
    res.locals.currentUrl = req.originalUrl;
    res.locals.navCategories = navCategories;
    res.locals.storeAnnouncements = storeAnnouncements;
    res.locals.cartCount = cartCount(req);
    res.locals.productImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/product-placeholder.svg');
    res.locals.categoryImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/category-placeholder.svg');
    res.locals.nl2br = nl2br;
    res.locals.renderRichText = renderRichText;

    res.locals.customer = null;
    if (req.session.customerId) {
      res.locals.customer = await Customer.findById(req.session.customerId).lean();
    }

    // Admin > Referral Program share link (?ref=<code>) — captured here so
    // it survives however the visitor browses before registering, not just
    // a direct hit on /register. Only looked up once, on the actual click
    // (when ?ref is present); resolves to a real Admin _id and is kept in
    // the session until POST /register (routes/store.js) consumes it, or
    // gets overwritten by a newer ?ref link.
    if (req.query.ref && !req.session.customerId) {
      const referrer = await Admin.findOne({ referralCode: String(req.query.ref).toUpperCase() }).select('_id').lean();
      if (referrer) req.session.referralAdminId = String(referrer._id);
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = storeLocals;
