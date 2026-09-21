/**
 * Route-level enforcement of the Staff > Roles permission matrix
 * (models/Role.js / PERMISSION_MODULES). Until now that matrix was
 * genuinely built and saved in the admin UI, but nothing actually
 * checked it — every logged-in staff account could reach every screen
 * regardless of what their role did or didn't grant. This file closes
 * that gap for the route groups where a module -> URL-prefix mapping is
 * unambiguous (see the router.use(...) calls in routes/admin.js, right
 * after `router.use(requireAdminLogin)`).
 *
 * Safety default — READ THIS BEFORE CHANGING ANYTHING BELOW:
 * `req.adminRole` is set by middleware/adminLocals.js. When it is null
 * (the logged-in account has no role assigned at all — Staff > Users >
 * "Role" left empty) this middleware treats the account as UNRESTRICTED
 * (full access), not locked out. Two reasons:
 *   1. The very first admin account ever created has no role, and must
 *      still be able to reach Staff > Roles to create one.
 *   2. Every admin account that existed before this file shipped has no
 *      role assigned either. Silently locking all of them out of most of
 *      the panel the moment this deploys would be a much worse outage
 *      than under-enforcing until an owner explicitly assigns roles.
 * Only an account that has been explicitly given a role is restricted to
 * what that role's permission matrix actually grants it.
 *
 * Granularity: PERMISSION_MODULES defines per-action checkboxes (create/
 * edit/delete/show/manage) inside each module, but the admin UI never
 * defined which action maps to which specific route — so this only
 * checks MODULE-level access (does the role have *any* checked action
 * under this module at all), not the individual action. That's an
 * honest simplification, not a bug: enforcing per-action would require
 * inventing a route<->action mapping the app never actually specified.
 *
 * Nested prefixes (e.g. /products/variant sitting under /products):
 * requireModule() marks a request as "handled" the first time any gate
 * clears it, and every later, broader gate for the same request just
 * calls next() without re-checking its own module. Register the more
 * specific prefix BEFORE the broader one so this resolves correctly —
 * see the ordering comment in routes/admin.js.
 */
function requireModule(moduleKey) {
  return function (req, res, next) {
    if (req._permissionGateHandled) return next(); // a more specific gate already cleared this request

    const role = req.adminRole;
    if (!role) {
      req._permissionGateHandled = true;
      return next(); // no role assigned = unrestricted, see safety default above
    }

    const grantedActions = role.permissions && role.permissions[moduleKey];
    if (Array.isArray(grantedActions) && grantedActions.length > 0) {
      req._permissionGateHandled = true;
      return next();
    }

    return res.status(403).render('admin/403', {
      adminPageTitle: 'Access Denied',
      moduleKey,
      roleName: role.name,
    });
  };
}

module.exports = { requireModule };
