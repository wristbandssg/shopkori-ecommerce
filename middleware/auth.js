function requireCustomerLogin(req, res, next) {
  if (!req.session.customerId) {
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdminLogin(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect('/admin/login');
  }
  next();
}

function requireVendorLogin(req, res, next) {
  if (!req.session.vendorId) {
    return res.redirect('/vendor/login');
  }
  next();
}

module.exports = { requireCustomerLogin, requireAdminLogin, requireVendorLogin };
