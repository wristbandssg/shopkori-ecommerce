const crypto = require('crypto');

function slugify(text) {
  return String(text)
    .toString()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ঀ-৿]+/g, '-') // keep bangla unicode range too
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || `item-${Date.now()}`;
}

function generateOrderNumber() {
  const date = new Date();
  const y = String(date.getFullYear()).slice(2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return `SK${y}${m}${d}${rand}`;
}

function currencyFormatter(symbol) {
  return function currency(amount) {
    const num = Number(amount || 0);
    return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
}

async function ensureUniqueSlug(Model, baseSlug, excludeId = null) {
  let slug = baseSlug;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { slug };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await Model.findOne(query);
    if (!existing) return slug;
    i += 1;
    slug = `${baseSlug}-${i}`;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(str) {
  return escapeHtml(str).replace(/\n/g, '<br>');
}

// Blog posts, static Pages and Page Builder pages all used to be a plain
// <textarea> (content = plain text, line breaks only), and are now written
// with the rich-text editor (views/admin/partials/rich-editor.ejs), whose
// content is real HTML. Rendering old plain-text content as raw HTML would
// just print literal "<" characters if anyone had typed them, and would
// lose their line breaks entirely (HTML collapses bare \n); rendering new
// HTML content through nl2br/escapeHtml would show the tags as visible
// text instead of formatting it. So: HTML-looking content renders as-is
// (this is admin-authored CMS content — the same trust level as the rest
// of the admin panel, e.g. the theme customizer's raw CSS/JS), anything
// else still goes through escaping + nl2br so nothing old breaks.
function renderRichText(str) {
  if (!str) return '';
  return /<[a-z][\s\S]*>/i.test(str) ? str : nl2br(str);
}

// Admin > API & Integration Management — "Sensitive API secrets should not
// be shown in full in the UI" (e.g. sk_live_****************8921). Display
// only; never touches the stored value itself.
function maskSecret(value) {
  const str = String(value || '');
  if (!str) return '';
  if (str.length <= 8) return '*'.repeat(str.length);
  const start = str.slice(0, 4);
  const end = str.slice(-4);
  const middle = '*'.repeat(Math.min(str.length - 8, 16));
  return `${start}${middle}${end}`;
}

module.exports = { slugify, generateOrderNumber, currencyFormatter, ensureUniqueSlug, escapeHtml, nl2br, renderRichText, maskSecret };
