const Admin = require('../models/Admin');
const { getSettings } = require('../models/Setting');
const { currencyFormatter } = require('./helpers');

async function adminLocals(req, res, next) {
  try {
    const settings = await getSettings();
    res.locals.settings = settings;
    res.locals.currency = currencyFormatter(settings.currency_symbol || '৳');
    res.locals.productImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/product-placeholder.svg');
    res.locals.categoryImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/category-placeholder.svg');
    res.locals.flashes = res.locals.flashes || [];
    res.locals.currentAdmin = null;

    // Derive which sidebar nav item should be highlighted from the URL, e.g.
    // /admin/products/123/edit -> "products", /admin -> "dashboard"
    const segment = req.path.split('/').filter(Boolean)[0] || '';
    res.locals.currentPage = segment || 'dashboard';
    if (req.session.adminId) {
      res.locals.currentAdmin = await Admin.findById(req.session.adminId).lean();
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = adminLocals;
