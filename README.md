# Supplier Database — PT Mesin Isuzu Indonesia

Aplikasi manajemen database supplier berbasis web, dibangun dengan HTML + Supabase.

## Fitur

- 🔐 **Autentikasi** — Login dengan email & password via Supabase Auth
- 👥 **Role-based Access** — Admin / Editor / Viewer dengan permission berbeda
- 🏢 **Manajemen Supplier** — CRUD lengkap dengan foto produk
- 📦 **Manajemen Kategori** — Tambah / hapus kategori (Admin)
- 👤 **Manajemen User** — Ubah role user (Admin)
- 📊 **Import / Export** — Import CSV / Excel, export CSV
- 📡 **Realtime** — Perubahan data otomatis tersinkron antar pengguna
- 📝 **Audit Log** — Setiap perubahan tercatat otomatis di database

## Teknologi

- **Frontend**: HTML, Tailwind CSS, Vanilla JavaScript
- **Backend**: [Supabase](https://supabase.com) (PostgreSQL, Auth, Storage, Realtime)

## Setup

### 1. Supabase

1. Buat project baru di [supabase.com](https://supabase.com)
2. Buka **SQL Editor** dan jalankan seluruh isi file `supabase_schema.sql`
3. Pastikan bucket `product-images` terbuat di **Storage**

### 2. Konfigurasi

Edit bagian ini di `public/app.js`:

```js
var SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
var SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

### 3. Buat User Pertama

1. Buka **Supabase Dashboard → Authentication → Users**
2. Klik **Invite user** atau **Add user**
3. User pertama yang mendaftar otomatis menjadi **Admin**

## Deploy

Aplikasi ini sudah dikonfigurasi untuk auto-deploy ke **GitHub Pages** via GitHub Actions.

Setelah push ke branch `main`, buka:
`https://<username>.github.io/<repository-name>/`

## Struktur File

```
├── public/
│   ├── index.html          # Aplikasi utama (HTML)
│   ├── app.js              # Aplikasi utama (JavaScript)
│   ├── 404.html            # Redirect SPA untuk GitHub Pages
│   └── .nojekyll           # Skip Jekyll processing
├── supabase_schema.sql     # Schema database Supabase
├── sample-import.csv       # Contoh file untuk import supplier
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions auto-deploy
└── README.md
```

## Role & Permission

| Aksi | Admin | Editor | Viewer |
|---|:---:|:---:|:---:|
| Lihat supplier | ✅ | ✅ | ✅ |
| Tambah / edit supplier | ✅ | ✅ | ❌ |
| Import CSV | ✅ | ✅ | ❌ |
| Hapus supplier | ✅ | ❌ | ❌ |
| Kelola kategori | ✅ | ❌ | ❌ |
| Ubah role user | ✅ | ❌ | ❌ |
| Lihat audit log | ✅ | ❌ | ❌ |
