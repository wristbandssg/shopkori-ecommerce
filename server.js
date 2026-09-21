require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const methodOverride = require('method-override');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const flashMiddleware = require('./middleware/flash');
const { csrfMiddleware } = require('./middleware/csrf');
const Product = require('./models/Product');
const BlogPost = require('./models/BlogPost');
const BlogCategory = require('./models/BlogCategory');

const app = express();
const PORT = process.env.PORT || 3000;

// Render.com (and most PaaS hosts) sit behind a reverse proxy, so without
// this req.ip always resolves to the proxy's address instead of the real
// visitor — which would break the Same IP Limit check in Admin > Orders >
// Order Setting. Same env var the session cookie's `secure` flag already
// keys off of.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ---- View engine ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Core middleware ----
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

async function bootstrap() {
  // Connect to MongoDB FIRST and let it fail fast/cleanly if misconfigured,
  // before wiring up anything (like the session store) that also needs a DB connection.
  await connectDB();

  // Reuse the single mongoose connection for the session store instead of opening
  // a second, unsupervised MongoDB connection (which previously crashed the process
  // with an unhandled rejection whenever the DB was unreachable).
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'shopkori-dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions' }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === 'true',
      },
    })
  );

  app.use(flashMiddleware);
  app.use(csrfMiddleware);

  // ---- Scheduled product publishing ----
  // Admin > Products lets a product be scheduled to go live at a future
  // date/time (publishStatus: 'scheduled', publishAt). Nothing else in the
  // request path flips it live on its own, so this small background job
  // does: every minute (and once at boot, to catch anything that came due
  // while the server was down), any scheduled product whose time has
  // arrived is switched to published/visible.
  async function publishDueScheduledProducts() {
    try {
      await Product.updateMany(
        { publishStatus: 'scheduled', publishAt: { $lte: new Date() } },
        { $set: { publishStatus: 'published', status: true } }
      );
    } catch (err) {
      console.error('[scheduled-publish]', err);
    }
  }
  publishDueScheduledProducts();
  setInterval(publishDueScheduledProducts, 60 * 1000);

  // ---- Scheduled blog post publishing (same pattern as products above) ----
  async function publishDueScheduledBlogPosts() {
    try {
      await BlogPost.updateMany(
        { publishStatus: 'scheduled', publishAt: { $lte: new Date() } },
        { $set: { publishStatus: 'published', status: true } }
      );
    } catch (err) {
      console.error('[scheduled-publish-blog]', err);
    }
  }
  publishDueScheduledBlogPosts();
  setInterval(publishDueScheduledBlogPosts, 60 * 1000);

  // ---- Scheduled blog category publishing (same pattern as above) ----
  async function publishDueScheduledBlogCategories() {
    try {
      await BlogCategory.updateMany(
        { publishStatus: 'scheduled', publishAt: { $lte: new Date() } },
        { $set: { publishStatus: 'published', status: true } }
      );
    } catch (err) {
      console.error('[scheduled-publish-blog-category]', err);
    }
  }
  publishDueScheduledBlogCategories();
  setInterval(publishDueScheduledBlogCategories, 60 * 1000);

  // ---- Routes ----
  app.use('/', require('./routes/store'));
  app.use('/admin', require('./routes/admin'));

  // ---- 404 ----
  app.use((req, res) => {
    res.status(404).render('404', { pageTitle: 'পেজ পাওয়া যায়নি' });
  });

  // ---- Error handler ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send(
      process.env.NODE_ENV === 'production'
        ? 'একটি সমস্যা হয়েছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।'
        : `<pre>${err.stack}</pre>`
    );
  });

  app.listen(PORT, () => {
    console.log(`[server] ShopKori running at http://localhost:${PORT}`);
  });
}

bootstrap();

module.exports = app;
