const fetch = require('node-fetch');

/**
 * Minimal SSLCommerz integration helper (REST session API).
 * Configure SSLCZ_STORE_ID / SSLCZ_STORE_PASSWORD in your .env with real
 * (or sandbox) credentials before using this in production.
 * Docs: https://developer.sslcommerz.com/doc/v4/
 */

function apiUrl() {
  const sandbox = String(process.env.SSLCZ_SANDBOX || 'true') === 'true';
  return sandbox
    ? 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'
    : 'https://securepay.sslcommerz.com/gwprocess/v4/api.php';
}

function validationUrl() {
  const sandbox = String(process.env.SSLCZ_SANDBOX || 'true') === 'true';
  return sandbox
    ? 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php'
    : 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php';
}

async function initSession(order, baseUrl) {
  const params = new URLSearchParams({
    store_id: process.env.SSLCZ_STORE_ID || '',
    store_passwd: process.env.SSLCZ_STORE_PASSWORD || '',
    total_amount: Number(order.total).toFixed(2),
    currency: 'BDT',
    tran_id: order.orderNumber,
    success_url: `${baseUrl}/payment/sslcommerz/success`,
    fail_url: `${baseUrl}/payment/sslcommerz/fail`,
    cancel_url: `${baseUrl}/payment/sslcommerz/cancel`,
    ipn_url: `${baseUrl}/payment/sslcommerz/ipn`,
    cus_name: order.customerName,
    cus_email: order.customerEmail || 'guest@example.com',
    cus_add1: order.shippingAddress,
    cus_city: order.shippingCity || 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: order.customerPhone,
    shipping_method: 'Courier',
    product_name: `Order ${order.orderNumber}`,
    product_category: 'General',
    product_profile: 'general',
  });

  try {
    const res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeout: 15000,
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { status: 'FAILED', failedreason: err.message };
  }
}

async function validateTransaction(valId) {
  const query = new URLSearchParams({
    val_id: valId,
    store_id: process.env.SSLCZ_STORE_ID || '',
    store_passwd: process.env.SSLCZ_STORE_PASSWORD || '',
    format: 'json',
  });
  try {
    const res = await fetch(`${validationUrl()}?${query.toString()}`, { timeout: 15000 });
    const data = await res.json();
    return data && ['VALID', 'VALIDATED'].includes(data.status);
  } catch (err) {
    return false;
  }
}

module.exports = { initSession, validateTransaction };
