const Product = require('../models/Product');

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== 'object') {
    req.session.cart = {};
  }
  return req.session.cart;
}

function cartAdd(req, productId, qty = 1) {
  const cart = getCart(req);
  const id = String(productId);
  cart[id] = (cart[id] || 0) + qty;
  if (cart[id] < 1) delete cart[id];
  req.session.cart = cart;
}

function cartSet(req, productId, qty) {
  const cart = getCart(req);
  const id = String(productId);
  if (qty <= 0) {
    delete cart[id];
  } else {
    cart[id] = qty;
  }
  req.session.cart = cart;
}

function cartRemove(req, productId) {
  const cart = getCart(req);
  delete cart[String(productId)];
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
 * Resolves the session cart into full product details + totals.
 */
async function cartDetails(req) {
  const cart = getCart(req);
  const ids = Object.keys(cart).filter((id) => cart[id] > 0);
  if (ids.length === 0) {
    return { items: [], subtotal: 0 };
  }
  const products = await Product.find({ _id: { $in: ids }, status: true });
  const items = [];
  let subtotal = 0;
  for (const product of products) {
    const qty = cart[String(product._id)] || 0;
    if (qty <= 0) continue;
    const price = product.salePrice && product.salePrice < product.price ? product.salePrice : product.price;
    const lineTotal = price * qty;
    subtotal += lineTotal;
    items.push({ product, qty, price, lineTotal });
  }
  return { items, subtotal };
}

module.exports = { getCart, cartAdd, cartSet, cartRemove, cartClear, cartCount, cartDetails };
