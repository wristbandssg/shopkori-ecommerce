# ShopKori — Node.js E-commerce Demo (Full Website + Admin Dashboard)

একটি সম্পূর্ণ ফাংশনাল ই-কমার্স ওয়েবসাইট — **Node.js (Express) + EJS + MongoDB** দিয়ে তৈরি, cloud-এ ডিপ্লয় করার জন্য রেডি (Render, Railway, বা যেকোনো Node হোস্টিং)।

এটি আগের PHP ভার্সনের হুবহু ফিচার নিয়ে Node.js-এ রিবিল্ড করা — একই ডিজাইন (নেভি ব্লু + গোল্ড, ৳ কারেন্সি), একই storefront + admin dashboard + পেমেন্ট মেথড।

---

## ফিচার তালিকা

**স্টোরফ্রন্ট** — হোমপেজ (ব্যানার/ক্যাটাগরি/ফ্ল্যাশ সেল/ফিচারড), ক্যাটাগরি ও প্রোডাক্ট লিস্টিং, প্রোডাক্ট ডিটেইলস, AJAX শপিং কার্ট, চেকআউট (COD/bKash/SSLCommerz), কাস্টমার লগইন/রেজিস্ট্রেশন, অর্ডার হিস্ট্রি, অর্ডার ট্র্যাকিং, সার্চ।

**অ্যাডমিন ড্যাশবোর্ড** — সিকিউর লগইন, সেলস/অর্ডার/কাস্টমার স্ট্যাট + চার্ট, প্রোডাক্ট CRUD (ছবি আপলোডসহ), ক্যাটাগরি CRUD, অর্ডার ম্যানেজমেন্ট, কাস্টমার লিস্ট, সেলস রিপোর্ট (কাস্টম ডেট রেঞ্জ, চার্ট, টপ প্রোডাক্ট), সাইট সেটিংস।

**টেক স্ট্যাক**: Express.js · EJS (server-rendered views) · MongoDB + Mongoose · express-session (MongoDB-এ সেশন স্টোর হয়, তাই সার্ভার রিস্টার্ট হলেও লগইন/কার্ট টেকে) · bcryptjs · multer (ইমেজ আপলোড)।

---

## লোকালি রান করা (টেস্টের জন্য)

1. **Node.js ইনস্টল করুন** (v18+): https://nodejs.org
2. **MongoDB দরকার** — লোকাল MongoDB চালান, অথবা সরাসরি ধাপ ৩ এ যেয়ে MongoDB Atlas এর ফ্রি ক্লাউড ডাটাবেস ব্যবহার করুন (সহজ, রেকমেন্ডেড)।
3. ডিপেন্ডেন্সি ইনস্টল করুন:
   ```
   npm install
   ```
4. `.env.example` কপি করে `.env` বানান এবং `MONGODB_URI` বসান:
   ```
   cp .env.example .env
   ```
5. ডেমো ডাটা (ক্যাটাগরি, প্রোডাক্ট, অ্যাডমিন ইউজার) সিড করুন:
   ```
   npm run seed
   ```
6. সার্ভার চালু করুন:
   ```
   npm start
   ```
   এখন সাইট চলবে: http://localhost:3000
   অ্যাডমিন প্যানেল: http://localhost:3000/admin/login (`admin` / `admin123`)

---

## ☁️ Cloud-এ লাইভ করা (ধাপে ধাপে)

এই স্ট্যাক (Node.js + MongoDB) cloud deploy করার জন্য সবচেয়ে সহজ — PHP hosting এর মতো cPanel/FTP লাগে না। দুইটা ফ্রি সার্ভিস দিয়েই পুরো কাজ হয়ে যাবে:

### ধাপ ১: MongoDB Atlas এ ডাটাবেস বানান (ফ্রি)
1. https://www.mongodb.com/cloud/atlas/register এ গিয়ে ফ্রি অ্যাকাউন্ট খুলুন
2. একটি ফ্রি **M0 Cluster** তৈরি করুন (কোনো কার্ড লাগে না)
3. **Database Access** এ গিয়ে একটি ইউজার/পাসওয়ার্ড বানান
4. **Network Access** এ গিয়ে "Allow access from anywhere" (0.0.0.0/0) যোগ করুন — Render/Railway থেকে কানেক্ট করার জন্য দরকার
5. **Connect** বাটনে ক্লিক করে "Drivers" থেকে Connection String কপি করুন, এমন দেখতে হবে:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/shopkori?retryWrites=true&w=majority
   ```

### ধাপ ২: GitHub-এ কোড পুশ করুন
এই প্রজেক্ট ফোল্ডারটা একটা নতুন GitHub রিপোজিটরিতে পুশ করুন (Render/Railway সরাসরি GitHub থেকে ডিপ্লয় করে)।

### ধাপ ৩: Render.com এ ডিপ্লয় করুন (ফ্রি টিয়ার আছে)
1. https://render.com এ অ্যাকাউন্ট খুলুন (GitHub দিয়ে সাইন-ইন করা সহজ)
2. **New +** → **Web Service** → আপনার GitHub রিপো সিলেক্ট করুন
3. সেটিংস দিন:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment Variables** এ গিয়ে যোগ করুন (`.env.example` থেকে):
   ```
   MONGODB_URI = <আপনার Atlas connection string>
   SESSION_SECRET = <যেকোনো লম্বা random string>
   NODE_ENV = production
   ```
5. **Create Web Service** ক্লিক করুন — কয়েক মিনিটে ডিপ্লয় হয়ে যাবে, একটা লাইভ URL পাবেন (যেমন `https://shopkori.onrender.com`)
6. Render-এর **Shell** ট্যাব থেকে (অথবা লোকাল থেকে `.env` এ Atlas URI বসিয়ে) একবার সিড কমান্ড চালান:
   ```
   npm run seed
   ```

> বিকল্প: Railway.app (https://railway.app) দিয়েও একইভাবে ডিপ্লয় করা যায় — GitHub রিপো কানেক্ট করে Environment Variables বসালেই হয়ে যায়, এমনকি Railway নিজেই ফ্রি MongoDB addon অফার করে।

### ধাপ ৪: ডোমেইন কানেক্ট (ঐচ্ছিক)
Render/Railway এর ড্যাশবোর্ডে **Custom Domain** সেকশনে গিয়ে নিজের ডোমেইন যোগ করে DNS-এ তাদের দেওয়া CNAME রেকর্ড বসিয়ে দিন।

---

## ফোল্ডার স্ট্রাকচার

```
ecommerce-node/
├── config/db.js            # MongoDB connection
├── lib/sslcommerz.js       # SSLCommerz payment gateway integration
├── middleware/             # auth, cart, csrf, flash, upload, helpers, locals
├── models/                 # Mongoose schemas: Category, Product, Customer, Admin, Order, Setting
├── routes/
│   ├── store.js            # সব স্টোরফ্রন্ট রুট (home, cart, checkout, auth ...)
│   └── admin.js             # সব অ্যাডমিন রুট
├── views/                  # EJS templates (storefront + views/admin/)
├── public/                 # css, js, images, uploads (স্ট্যাটিক ফাইল)
├── scripts/seed.js         # ডেমো ডাটা সিড করার স্ক্রিপ্ট
├── server.js                # অ্যাপ এন্ট্রি পয়েন্ট
├── .env.example             # কনফিগারেশনের টেমপ্লেট
└── package.json
```

---

## পেমেন্ট মেথড সম্পর্কে

1. **Cash on Delivery (COD)** — কোনো সেটআপ লাগে না।
2. **bKash (Manual)** — কাস্টমার bKash নম্বরে টাকা পাঠিয়ে Transaction ID দেন; অ্যাডমিন প্যানেল থেকে ভেরিফাই করে Payment Status "Paid" করতে হবে। `.env` এ `BKASH_NUMBER` বসান।
3. **SSLCommerz** — `lib/sslcommerz.js` এ রেডি-টু-কনফিগার ইন্টিগ্রেশন আছে। `.env` এ `SSLCZ_STORE_ID` / `SSLCZ_STORE_PASSWORD` বসালেই কাজ করবে (sandbox দিয়ে ফ্রি টেস্ট করা যায়: https://developer.sslcommerz.com)। কনফিগার না থাকলে অর্ডার "Payment Pending" রেখে সাইট চালু থাকবে, ভাঙবে না।

---

## গুরুত্বপূর্ণ নোট

- এটি একটি **starter/demo প্রজেক্ট** — প্রোডাকশনে যাওয়ার আগে: admin পাসওয়ার্ড পরিবর্তন করুন, `.env` এ শক্তিশালী `SESSION_SECRET` বসান, HTTPS নিশ্চিত করুন।
- ডেমো প্রোডাক্ট ছবিগুলো placeholder — অ্যাডমিন প্যানেল থেকে আসল ছবি আপলোড করুন। **নোট:** Render/Railway এর ফ্রি টিয়ারের ফাইল সিস্টেম *ephemeral* (রিডিপ্লয়ে uploads ফোল্ডার খালি হয়ে যেতে পারে) — প্রোডাকশনে ছবি হোস্ট করতে Cloudinary বা AWS S3 এর মতো একটা external storage যোগ করার কথা ভাবুন।
- সেশন MongoDB-তে জমা হয় (`connect-mongo`), তাই সার্ভার রিস্টার্ট/রিডিপ্লয় হলেও ইউজার লগইন থাকে।

শুভকামনা! 🎉
