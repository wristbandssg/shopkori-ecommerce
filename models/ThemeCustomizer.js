const mongoose = require('mongoose');

/**
 * Singleton document backing the "Advance Theme Setup" page (see
 * views/admin/customization-theme.ejs) — a much richer, dedicated theme
 * customizer than models/StoreCustomization.js's simple toggle set.
 *
 * Defaults below are pre-filled to match the site's REAL current colors/
 * fonts (public/css/style.css's :root block: --brand-pink #EC0E8C,
 * --brand-pink-dark #B80E71, --brand-blue #2F5FE0, --text-dark #222222,
 * fonts Poppins/Hind Siliguri) so the color pickers start out showing what
 * the storefront actually looks like today, not arbitrary black.
 *
 * Which fields are LIVE (change the real storefront via the <style> block
 * injected in views/partials/header.ejs, driven by middleware/storeLocals.js)
 * vs SAVED-ONLY (no safe, unambiguous storefront element/route to wire
 * into yet) is documented per-field below.
 */
const themeCustomizerSchema = new mongoose.Schema(
  {
    themeName: { type: String, default: 'Theme 1' }, // label only — the site has one real theme today

    // LIVE: renders a colored bar above the header when text is set.
    topHeader: {
      color: { type: String, default: '#ffffff' },
      text: { type: String, default: '' },
      bold: { type: Boolean, default: false },
      textAlign: { type: String, default: 'center' }, // left | center | right
      scrollingMarquee: { type: Boolean, default: false },
      backgroundColor: { type: String, default: '#EC0E8C' },
    },

    // LIVE: .main-header background, .brand-logo text color.
    header: {
      textColor: { type: String, default: '#222222' },
      backgroundColor: { type: String, default: '#ffffff' },
    },

    // LIVE: .category-nav colors + font-family.
    navMenu: {
      linksColor: { type: String, default: '#ffe6f5' },
      backgroundColor: { type: String, default: '#EC0E8C' },
      linkHoverColor: { type: String, default: '#ffffff' },
      fontFamily: { type: String, default: "'Hind Siliguri', sans-serif" },
    },

    category: {
      // SAVE-ONLY: .section-heading is shared by several unrelated
      // homepage sections (Popular/Flash Sale/etc, see views/index.ejs),
      // so there's no category-only heading element to safely target.
      headerBackgroundColor: { type: String, default: '#ffffff' },
      headerTitleColor: { type: String, default: '#222222' },
      headerTitleText: { type: String, default: 'ক্যাটাগরি' },
      headerFontFamily: { type: String, default: "'Poppins', sans-serif" },
      navFontSize: { type: String, default: '14px' },
      bodyLayout: { type: String, default: 'Fixed Layout' },
      // LIVE below this line — .category-grid / .category-tile are category-only.
      bodyShape: { type: String, default: '50%' }, // .category-tile-img border-radius
      rowItem: { type: String, default: '6-item' }, // .category-grid column count
      rowBackgroundColor: { type: String, default: 'transparent' },
      borderColor: { type: String, default: '#f6d5ea' },
      namePosition: { type: String, default: 'Box Style' }, // save-only, one option shown
      previewBackgroundColor: { type: String, default: 'transparent' },
      previewTextColor: { type: String, default: '#222222' },
    },

    product: {
      // LIVE: .product-title / .price-now / .btn-add-cart / .btn-buy-now / .badge-discount / .product-card
      nameColor: { type: String, default: '#222222' },
      priceColor: { type: String, default: '#EC0E8C' },
      boxStyle: { type: String, default: 'without' }, // without | with -> product-card border on/off
      nameSize: { type: String, default: '14px' },
      priceTextSize: { type: String, default: '16px' },
      discountBarBgColor: { type: String, default: '#E63946' },
      discountBarTextColor: { type: String, default: '#ffffff' },
      cardBorderColor: { type: String, default: '#f7d3ea' },
      cardBorderSize: { type: String, default: '1px' },
      addToCartName: { type: String, default: 'আরো কিনুন' },
      buyNowName: { type: String, default: 'এখনই কিনুন' },
      addToCartColor: { type: String, default: '#EC0E8C' },
      addToCartTextColor: { type: String, default: '#ffffff' },
      buyNowColor: { type: String, default: '#2F5FE0' },
      buyNowTextColor: { type: String, default: '#ffffff' },
      discountPriceTextColor: { type: String, default: '#999999' },
      discountPriceTextSize: { type: String, default: '13px' },
      buttonOrder: { type: String, default: 'cart-then-buy' }, // cart-then-buy | buy-then-cart
      showAddToCartIcon: { type: Boolean, default: false },
      showBuyNowIcon: { type: Boolean, default: false },
      buttonLayout: { type: String, default: 'horizontal' }, // horizontal | vertical
      // SAVE-ONLY: no second currency source / no swipe-carousel JS built yet.
      currencySign: { type: String, default: 'Tk' },
      swipeOption: { type: Boolean, default: false },
    },

    // SAVE-ONLY: changing which categories/how many show on the homepage
    // means editing the homepage route's query logic (routes/store.js),
    // which is out of scope for this pass — disclosed, not wired.
    // productsDesktop/Tablet/Mobile ARE live (drive .product-grid columns).
    home: {
      productsDesktop: { type: Number, default: 4 },
      productsTablet: { type: Number, default: 3 },
      productsMobile: { type: Number, default: 2 },
      clothingStyle: { type: Boolean, default: false },
      selectedCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      showAllProductsCategory: { type: Boolean, default: true },
    },

    // LIVE: .site-footer background + text color.
    footer: {
      backgroundColor: { type: String, default: '#EC0E8C' },
      textColor: { type: String, default: '#ffe6f5' },
    },
  },
  { timestamps: true }
);

const ThemeCustomizerModel = mongoose.model('ThemeCustomizer', themeCustomizerSchema);

let cache = null;

async function getThemeCustomizer() {
  if (cache) return cache;
  let doc = await ThemeCustomizerModel.findOne({}).populate('home.selectedCategories');
  if (!doc) doc = await ThemeCustomizerModel.create({});
  cache = doc;
  return doc;
}

async function updateThemeCustomizer(partial) {
  const doc = await ThemeCustomizerModel.findOne({}) || (await ThemeCustomizerModel.create({}));
  Object.keys(partial).forEach((key) => {
    const current = doc[key];
    if (current && typeof current === 'object' && typeof current.toObject === 'function' && !Array.isArray(current)) {
      doc[key] = { ...current.toObject(), ...partial[key] };
    } else {
      doc[key] = partial[key];
    }
  });
  await doc.save();
  cache = null;
  return doc;
}

module.exports = { ThemeCustomizerModel, getThemeCustomizer, updateThemeCustomizer };
