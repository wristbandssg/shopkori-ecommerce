const Admin = require('../models/Admin');
const Order = require('../models/Order');
const { getSettings } = require('../models/Setting');
const { currencyFormatter } = require('./helpers');
const {
  ORDER_STATUSES, COURIERS, statusLabel, statusBadge,
  DELIVERY_STATUSES, RETURN_STATUSES,
  deliveryStatusLabel, deliveryStatusBadge, returnStatusLabel, returnStatusBadge,
} = require('./orderConstants');

async function adminLocals(req, res, next) {
  try {
    const settings = await getSettings();
    res.locals.settings = settings;
    res.locals.currency = currencyFormatter(settings.currency_symbol || '৳');
    res.locals.productImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/product-placeholder.svg');
    res.locals.categoryImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/category-placeholder.svg');
    res.locals.landingImageUrl = (filename) => (filename ? (filename.startsWith('product_') ? `/uploads/${filename}` : `/images/${filename}`) : '/images/product-placeholder.svg');
    res.locals.flashes = res.locals.flashes || [];
    res.locals.currentAdmin = null;
    // Made available on every admin page so views never need to remember
    // to pass these through render() individually.
    res.locals.ORDER_STATUSES = ORDER_STATUSES;
    res.locals.COURIERS = COURIERS;
    res.locals.statusLabel = statusLabel;
    res.locals.statusBadge = statusBadge;
    res.locals.DELIVERY_STATUSES = DELIVERY_STATUSES;
    res.locals.RETURN_STATUSES = RETURN_STATUSES;
    res.locals.deliveryStatusLabel = deliveryStatusLabel;
    res.locals.deliveryStatusBadge = deliveryStatusBadge;
    res.locals.returnStatusLabel = returnStatusLabel;
    res.locals.returnStatusBadge = returnStatusBadge;

    // Derive which sidebar nav item should be highlighted from the URL, e.g.
    // /admin/products/123/edit -> "products", /admin -> "dashboard"
    const segment = req.path.split('/').filter(Boolean)[0] || '';
    res.locals.currentPage = segment || 'dashboard';
    // Full path (relative to /admin) for highlighting the exact submenu link,
    // e.g. "/orders/incomplete" so only that one row lights up, not the whole group.
    res.locals.currentSubPath = req.path;
    // e.g. /admin/orders?status=delivered -> "delivered", used to highlight
    // the right status link inside an already-expanded Orders submenu.
    res.locals.currentQueryStatus = req.query.status || '';
    res.locals.orderCounts = { all: 0, incomplete: 0, delivered: 0, returned: 0, deliveryIssue: 0, deleted: 0 };
    if (req.session.adminId) {
      res.locals.currentAdmin = await Admin.findById(req.session.adminId).lean();

      // Sidebar badge counts for the Orders submenu (single cheap $facet
      // query so this doesn't add N round-trips per page load).
      const [facets] = await Order.aggregate([
        {
          $facet: {
            all: [{ $match: { isDeleted: false } }, { $count: 'n' }],
            incomplete: [
              { $match: { isDeleted: false, paymentMethod: { $in: ['bkash', 'sslcommerz'] }, paymentStatus: { $in: ['pending', 'unpaid'] }, incompleteStatus: 'new' } },
              { $count: 'n' },
            ],
            delivered: [{ $match: { isDeleted: false, status: 'delivered' } }, { $count: 'n' }],
            returned: [{ $match: { isDeleted: false, status: 'returned' } }, { $count: 'n' }],
            deliveryIssue: [{ $match: { isDeleted: false, status: 'delivery_issue' } }, { $count: 'n' }],
            deleted: [{ $match: { isDeleted: true } }, { $count: 'n' }],
          },
        },
      ]);
      const pick = (arr) => (arr && arr[0] ? arr[0].n : 0);
      res.locals.orderCounts = {
        all: pick(facets.all),
        incomplete: pick(facets.incomplete),
        delivered: pick(facets.delivered),
        returned: pick(facets.returned),
        deliveryIssue: pick(facets.deliveryIssue),
        deleted: pick(facets.deleted),
      };
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = adminLocals;
