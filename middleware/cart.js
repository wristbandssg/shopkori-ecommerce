const Product = require('../models/Product');

// A cart line is keyed by productId alone, or "productId::variantId" when a
// specific variant was chosen — so the same product can sit in the cart
// multiple times as different variants, each with its own price/stock.
function cartKey(productId, variantId) {
  return variantId ? `${productId}::${variantId}` : String(productId);
}

function parseKey(key) {
  const [productId, variantId] = key.split('::');
  return { productId, variantId: variantId || null };
}

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== 'object') {
    req.session.cart = {};
  }
  return req.session.cart;
}

function cartAdd(req, productId, qty = 1, variantId = null) {
  const cart = getCart(req);
  const key = cartKey(productId, variantId);
  cart[key] = (cart[key] || 0) + qty;
  if (cart[key] < 1) delete cart[key];
  req.session.cart = cart;
}

function cartSet(req, productId, qty, variantId = null) {
  const cart = getCart(req);
  const key = cartKey(productId, variantId);
  if (qty <= 0) {
    delete cart[key];
  } else {
    cart[key] = qty;
  }
  req.session.cart = cart;
}

function cartRemove(req, productId, variantId = null) {
  const cart = getCart(req);
  delete cart[cartKey(productId, variantId)];
  req.session.cart = cart;
}

function cartClear(req) {
  req.session.cart = {};
}

function cartCount(req) {
  const cart = getCart(req);
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

/**
 * Resolves the session cart into full product/variant details + totals.
 * Each item is { product, variant, variantLabel, qty, price, stock, cartKey }.
 */
async function cartDetails(req) {
  const cart = getCart(req);
  const keys = Object.keys(cart).filter((key) => cart[key] > 0);
  if (keys.length === 0) {
    return { items: [], subtotal: 0 };
  }

  const productIds = [...new Set(keys.map((key) => parseKey(key).productId))];
  const products = await Product.find({ _id: { $in: productIds }, status: true });
  const productMap = {};
  products.forEach((p) => { productMap[String(p._id)] = p; });

  const items = [];
  let subtotal = 0;
  let dirty = false;

  for (const key of keys) {
    const qty = cart[key] || 0;
    if (qty <= 0) continue;
    const { productId, variantId } = parseKey(key);
    const product = productMap[productId];
    if (!product) {
      // Product was deleted/hidden since it was added — drop the stale line.
      delete cart[key];
      dirty = true;
      continue;
    }
    const resolved = product.resolveVariant(variantId);
    if (!resolved) {
      // Variant no longer exists (e.g. admin removed it) — drop the line.
      delete cart[key];
      dirty = true;
      continue;
    }
    const lineTotal = resolved.price * qty;
    subtotal += lineTotal;
    items.push({
      product,
      variant: resolved.variant,
      variantLabel: resolved.label,
      qty,
      price: resolved.price,
      stock: resolved.stock,
      cartKey: key,
    });
  }

  if (dirty) req.session.cart = cart;

  return { items, subtotal };
}

module.exports = { getCart, cartKey, parseKey, cartAdd, cartSet, cartRemove, cartClear, cartCount, cartDetails };
