const Category = require('../models/Category');
const Customer = require('../models/Customer');
const { getSettings } = require('../models/Setting');
const { getMarketingSettings } = require('../models/MarketingSetting');
const { getThemeCustomizer } = require('../models/ThemeCustomizer');
const { currencyFormatter, nl2br } = require('./helpers');
const { cartCount } = require('./cart');

/**
 * Populates res.locals with everything the storefront header/footer views need:
 * settings, currency formatter, nav categories, cart count, and the logged-in customer.
 * Mirrors what includes/header.php did on every PHP page load.
 */
async function storeLocals(req, res, next) {
  try {
    const [settings, allCategories, marketing, themeCustomizer] = await Promise.all([
      getSettings(),
      Category.find({ status: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      getMarketingSettings(),
      getThemeCustomizer(),
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
    res.locals.currency = currencyFormatter(settings.currency_symbol || '৳');
    // Absolute site URL, used to build canonical links and the absolute
    // URLs schema.org JSON-LD structured data requires (Organization/WebSite
    // on every page, Product/BreadcrumbList on product & category pages).
    res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
    // req itself isn't passed to EJS views, so the current path is exposed
    // separately for the canonical <link> tag (header.ejs).
    res.locals.currentUrl = req.originalUrl;
    res.locals.navCategories = navCategories;
    res.locals.cartCount = cartCount(req);
    res.locals.productImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/product-placeholder.svg');
    res.locals.categoryImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/category-placeholder.svg');
    res.locals.nl2br = nl2br;

    res.locals.customer = null;
    if (req.session.customerId) {
      res.locals.customer = await Customer.findById(req.session.customerId).lean();
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = storeLocals;
