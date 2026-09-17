const Category = require('../models/Category');
const Customer = require('../models/Customer');
const { getSettings } = require('../models/Setting');
const { currencyFormatter, nl2br } = require('./helpers');
const { cartCount } = require('./cart');

/**
 * Populates res.locals with everything the storefront header/footer views need:
 * settings, currency formatter, nav categories, cart count, and the logged-in customer.
 * Mirrors what includes/header.php did on every PHP page load.
 */
async function storeLocals(req, res, next) {
  try {
    const [settings, categories] = await Promise.all([
      getSettings(),
      Category.find({ status: true }).sort({ sortOrder: 1, name: 1 }),
    ]);

    res.locals.settings = settings;
    res.locals.currency = currencyFormatter(settings.currency_symbol || '৳');
    res.locals.navCategories = categories;
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
