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

module.exports = { requireCustomerLogin, requireAdminLogin };
