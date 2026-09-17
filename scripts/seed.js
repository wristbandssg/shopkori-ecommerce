/**
 * Seeds the database with demo categories, products, an admin user, and default
 * site settings — the Node.js equivalent of importing database/schema.sql in the
 * PHP version. Safe to re-run: it skips creating things that already exist.
 *
 * Usage: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');

const Category = require('../models/Category');
const Product = require('../models/Product');
const Admin = require('../models/Admin');
const { ensureDefaults } = require('../models/Setting');
const { slugify } = require('../middleware/helpers');

const CATEGORIES = [
  'Birthday Gifts', 'Cakes', 'Flowers', 'Chocolates & Hampers', 'Anniversary Gifts',
  'Grocery & Daily Bazar', 'Health & Wellness', 'Honey & Organic', 'Electronics & Gadgets',
  'Fashion', 'Baby & Kids', 'Beauty & Personal Care',
];

const PRODUCTS = [
  { cat: 'Birthday Gifts', name: 'Surprise Birthday Combo Box', sku: 'BD-1001', short: 'Cake + balloons + greeting card combo', desc: 'A delightful birthday surprise combo including a half kg chocolate cake, a bunch of balloons, and a handwritten greeting card. Perfect for same-day delivery.', price: 1850, sale: 1599, stock: 25, featured: true, flash: true, rating: 4.7 },
  { cat: 'Cakes', name: 'Chocolate Truffle Cake (1kg)', sku: 'CK-1002', short: 'Rich Belgian chocolate truffle cake', desc: 'Moist chocolate sponge layered with silky truffle ganache, topped with chocolate shavings. Baked fresh daily.', price: 1200, sale: null, stock: 40, featured: true, flash: false, rating: 4.8 },
  { cat: 'Cakes', name: 'Red Velvet Cake (1kg)', sku: 'CK-1003', short: 'Classic red velvet with cream cheese frosting', desc: 'Soft red velvet sponge with cream cheese frosting, a customer favourite for birthdays and anniversaries.', price: 1350, sale: 1199, stock: 30, featured: true, flash: true, rating: 4.6 },
  { cat: 'Flowers', name: 'Rose Bouquet (12 Stems)', sku: 'FL-1004', short: 'Fresh red roses wrapped in premium paper', desc: 'A dozen freshly cut red roses beautifully wrapped, ideal for anniversaries and romantic occasions.', price: 1500, sale: null, stock: 50, featured: false, flash: false, rating: 4.5 },
  { cat: 'Flowers', name: 'Mixed Flower Basket', sku: 'FL-1005', short: 'Seasonal mixed flowers in a basket', desc: 'A vibrant arrangement of seasonal flowers in a decorative basket, perfect for any celebration.', price: 2200, sale: 1899, stock: 15, featured: true, flash: false, rating: 4.4 },
  { cat: 'Chocolates & Hampers', name: 'Premium Chocolate Hamper', sku: 'CH-1006', short: 'Assorted imported chocolates gift hamper', desc: 'A curated hamper of imported chocolates, cookies, and nuts arranged in an elegant gift box.', price: 2800, sale: 2450, stock: 20, featured: true, flash: true, rating: 4.9 },
  { cat: 'Chocolates & Hampers', name: 'Ferrero Rocher Box (24pcs)', sku: 'CH-1007', short: 'Classic Ferrero Rocher gift box', desc: 'The iconic hazelnut chocolate in a 24-piece gift box, loved by all ages.', price: 1600, sale: null, stock: 60, featured: false, flash: false, rating: 4.7 },
  { cat: 'Anniversary Gifts', name: 'Couple Coffee Mug Set', sku: 'AN-1008', short: 'Printed ceramic mug set for couples', desc: 'A set of two ceramic mugs with a customisable romantic print, packed in a gift box.', price: 950, sale: 799, stock: 45, featured: false, flash: true, rating: 4.3 },
  { cat: 'Grocery & Daily Bazar', name: 'Natural Honey (500g)', sku: 'GR-1009', short: '100% pure natural honey, lab tested', desc: 'Raw and unprocessed natural honey sourced from the Sundarbans, rich in antioxidants.', price: 650, sale: 599, stock: 100, featured: true, flash: false, rating: 4.8 },
  { cat: 'Grocery & Daily Bazar', name: 'Premium Basmati Rice (5kg)', sku: 'GR-1010', short: 'Long grain aromatic basmati rice', desc: 'High quality aromatic basmati rice, perfect for biryani and everyday cooking.', price: 850, sale: null, stock: 80, featured: false, flash: false, rating: 4.5 },
  { cat: 'Health & Wellness', name: 'Multivitamin Tablets (60ct)', sku: 'HW-1011', short: 'Daily immunity support supplement', desc: 'A daily multivitamin supplement to support immunity and overall wellness.', price: 780, sale: 699, stock: 70, featured: false, flash: false, rating: 4.2 },
  { cat: 'Electronics & Gadgets', name: 'Wireless Bluetooth Earbuds', sku: 'EL-1012', short: 'TWS earbuds with charging case', desc: 'Compact true wireless earbuds with noise isolation, 20-hour battery life with charging case.', price: 2500, sale: 1999, stock: 35, featured: true, flash: true, rating: 4.4 },
  { cat: 'Fashion', name: "Men's Cotton Panjabi", sku: 'FS-1013', short: 'Comfortable festive panjabi', desc: 'Premium cotton panjabi with fine embroidery, great for Eid and festive occasions.', price: 1450, sale: 1250, stock: 40, featured: false, flash: false, rating: 4.3 },
  { cat: 'Baby & Kids', name: 'Baby Soft Cotton Romper Set', sku: 'BB-1014', short: 'Pack of 3 baby rompers', desc: 'Soft breathable cotton rompers for newborns, pack of 3 in assorted colours.', price: 990, sale: null, stock: 55, featured: false, flash: false, rating: 4.6 },
  { cat: 'Beauty & Personal Care', name: 'Herbal Face Wash Combo', sku: 'BP-1015', short: 'Neem & tea tree face wash pack of 2', desc: 'Herbal face wash formulated with neem and tea tree oil for clear, healthy skin.', price: 590, sale: 499, stock: 90, featured: false, flash: true, rating: 4.1 },
];

async function seed() {
  await connectDB();

  // ---- Settings ----
  await ensureDefaults();
  console.log('[seed] Default settings ensured.');

  // ---- Admin user ----
  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminExists = await Admin.findOne({ username: adminUsername });
  if (!adminExists) {
    const hashed = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'admin123', 10);
    await Admin.create({
      username: adminUsername,
      email: process.env.SEED_ADMIN_EMAIL || 'admin@shopkori.test',
      password: hashed,
      fullName: 'Site Administrator',
      role: 'admin',
    });
    console.log(`[seed] Admin user created: ${adminUsername} / ${process.env.SEED_ADMIN_PASSWORD || 'admin123'}`);
  } else {
    console.log('[seed] Admin user already exists, skipping.');
  }

  // ---- Categories ----
  const categoryMap = {};
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const name = CATEGORIES[i];
    const slug = slugify(name);
    let cat = await Category.findOne({ slug });
    if (!cat) {
      cat = await Category.create({ name, slug, sortOrder: i + 1, status: true });
      console.log(`[seed] Category created: ${name}`);
    }
    categoryMap[name] = cat._id;
  }

  // ---- Products ----
  let createdCount = 0;
  for (const p of PRODUCTS) {
    const slug = slugify(p.name);
    const exists = await Product.findOne({ slug });
    if (exists) continue;
    await Product.create({
      category: categoryMap[p.cat] || null,
      name: p.name,
      slug,
      sku: p.sku,
      shortDescription: p.short,
      description: p.desc,
      price: p.price,
      salePrice: p.sale,
      stock: p.stock,
      image: 'product-placeholder.svg',
      isFeatured: p.featured,
      isFlashSale: p.flash,
      status: true,
      rating: p.rating,
    });
    createdCount += 1;
  }
  console.log(`[seed] ${createdCount} product(s) created (${PRODUCTS.length - createdCount} already existed).`);

  console.log('[seed] Done!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
