# Kas Monitor — Aplikasi Monitoring Kas Operasional

Aplikasi monitoring kas operasional yang telah dimigrasi dari **Google Apps Script + Google Sheets** ke **Supabase (PostgreSQL + Edge Functions) + GitHub Pages**.

## Arsitektur

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────┐
│   Frontend       │────▶│  Supabase Edge        │────▶│  Supabase    │
│   (GitHub Pages) │     │  Functions (Deno)     │     │  PostgreSQL  │
│   HTML/CSS/JS    │◀────│  REST API             │◀────│  Database    │
└─────────────────┘     └──────────────────────┘     └──────────────┘
```

## Struktur Project

```
kas-monitor/
├── frontend/
│   ├── index.html          # Aplikasi utama (SPA)
│   ├── config.js           # Konfigurasi API & auth helper
│   └── README.md
├── supabase/
│   ├── migrations/
│   │   └── 001_init.sql    # SQL schema (11 tabel + RLS + seed)
│   └── functions/
│       ├── _shared/        # Shared utilities (CORS, Supabase client)
│       ├── auth/           # POST /api/auth — Login
│       ├── users/          # GET/POST/DELETE /api/users
│       ├── bon-setor/      # GET/POST/DELETE /api/bon-setor
│       ├── posisi-kas/     # GET/POST /api/posisi-kas
│       ├── saldo-awal-ht/  # GET/POST /api/saldo-awal-ht
│       ├── pegawai/        # GET/POST /api/pegawai
│       ├── hari-libur/     # GET/POST/DELETE /api/hari-libur
│       ├── pesanan-nasabah/# GET/POST/DELETE /api/pesanan-nasabah
│       ├── perkiraan/      # GET/POST /api/perkiraan
│       ├── setting-wa-gateway/ # GET/POST /api/setting-wa-gateway (✅ WA Gateway)
│       ├── pejabat-ht/     # GET/POST /api/pejabat-ht
│       ├── next-working-day/# GET /api/next-working-day
│       ├── laporan-ht/     # GET /api/laporan-ht
│       ├── cluis/          # GET /api/cluis
│       ├── tutup-buku/     # POST /api/tutup-buku
│       ├── dashboard/      # GET /api/dashboard
│       ├── tabularis/      # GET /api/tabularis
│       └── notif-wa-gateway/ # POST /api/notif-wa-gateway (✅ WA Gateway)
│       ├── notif-fonnte/   # [DEPRECATED] POST /api/notif-fonnte (diganti di atas)
│       └── setting-fonnte/ # [DEPRECATED] GET/POST /api/setting-fonnte (diganti di atas)
└── .github/
    └── workflows/
        └── deploy.yml      # Auto-deploy ke GitHub Pages
```

## Cara Setup

### 1. Buat Project Supabase

1. Buka [supabase.com](https://supabase.com) dan buat project baru
2. Catat **Project URL** dan **anon key** (dari Settings → API)
3. Catat **service_role key** (untuk deploy Edge Functions)

### 2. Jalankan Migration SQL

1. Buka **SQL Editor** di Supabase Dashboard
2. Copy-paste isi `supabase/migrations/001_init.sql`
3. Klik **Run**
4. Semua 11 tabel akan terbuat dengan RLS enabled

### 3. Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref [YOUR_PROJECT_REF]

# Deploy semua functions
cd supabase/functions
for dir in */; do
  supabase functions deploy "${dir%/}" --no-verify-jwt
done
```

Atau deploy satu per satu:

```bash
supabase functions deploy auth --no-verify-jwt
supabase functions deploy users --no-verify-jwt
supabase functions deploy bon-setor --no-verify-jwt
supabase functions deploy posisi-kas --no-verify-jwt
supabase functions deploy saldo-awal-ht --no-verify-jwt
supabase functions deploy pegawai --no-verify-jwt
supabase functions deploy hari-libur --no-verify-jwt
supabase functions deploy pesanan-nasabah --no-verify-jwt
supabase functions deploy perkiraan --no-verify-jwt
supabase functions deploy setting-fonnte --no-verify-jwt
supabase functions deploy pejabat-ht --no-verify-jwt
supabase functions deploy next-working-day --no-verify-jwt
supabase functions deploy laporan-ht --no-verify-jwt
supabase functions deploy cluis --no-verify-jwt
supabase functions deploy tutup-buku --no-verify-jwt
supabase functions deploy dashboard --no-verify-jwt
supabase functions deploy tabularis --no-verify-jwt
supabase functions deploy notif-fonnte --no-verify-jwt
```

Set environment variables untuk setiap function:

```bash
supabase secrets set SUPABASE_URL="https://[YOUR_PROJECT].supabase.co"
supabase secrets set SUPABASE_ANON_KEY="[YOUR_ANON_KEY]"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="[YOUR_SERVICE_ROLE_KEY]"
```

### 4. Konfigurasi Frontend

Edit `frontend/config.js`:

```javascript
const CONFIG = {
  API_URL: "https://[YOUR_PROJECT].supabase.co/functions/v1",
  SUPABASE_URL: "https://[YOUR_PROJECT].supabase.co",
  SUPABASE_ANON_KEY: "[YOUR_ANON_KEY]",
};
```

### 5. Deploy Frontend ke GitHub Pages

1. Push semua kode ke repository GitHub (branch `main`)
2. GitHub Actions akan auto-deploy folder `frontend/` ke GitHub Pages
3. Atau deploy manual lewat **Settings → Pages → Source: GitHub Actions**

## API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/auth` | Login user |
| GET/POST/DELETE | `/api/users` | CRUD users |
| GET/POST/DELETE | `/api/bon-setor` | Transaksi bon/setor |
| GET/POST | `/api/posisi-kas` | Posisi kas teller |
| GET/POST | `/api/saldo-awal-ht` | Saldo awal khasanah |
| GET/POST | `/api/pegawai` | Data pegawai |
| GET/POST/DELETE | `/api/hari-libur` | Hari libur |
| GET/POST/DELETE | `/api/pesanan-nasabah` | Pesanan nasabah |
| GET/POST | `/api/perkiraan` | Perkiraan bon/setor |
| GET/POST | `/api/setting-fonnte` | Setting notifikasi WA |
| GET/POST | `/api/pejabat-ht` | Data pejabat HT |
| GET | `/api/next-working-day` | Hari kerja berikutnya |
| GET | `/api/laporan-ht` | Laporan saldo & mutasi |
| GET | `/api/cluis` | Laporan cluis |
| POST | `/api/tutup-buku` | Tutup buku & arsip |
| GET | `/api/dashboard` | Dashboard HT/Teller |
| GET | `/api/tabularis` | Laporan tabularis |
| POST | `/api/notif-fonnte` | Kirim notifikasi WA |

## Database Tables

| Tabel | Deskripsi |
|-------|-----------|
| `users` | User & auth |
| `bon_setor` | Transaksi bon/setor |
| `arsip_bon_setor` | Arsip transaksi |
| `posisi_kas` | Posisi kas harian |
| `saldo_awal_ht` | Saldo awal khasanah |
| `data_pegawai` | Data pegawai teller |
| `data_pejabat_ht` | Data pejabat HT |
| `setting_fonnte` | Konfigurasi WA Fonnte |
| `perkiraan_bon_setor` | Perkiraan kebutuhan uang |
| `hari_libur` | Daftar hari libur |
| `pesanan_nasabah` | Pesanan uang nasabah |

## Default Login

- **Username**: `admin`
- **Password**: `super`
- **Role**: admin

## Migrasi dari Google Apps Script

Aplikasi ini adalah hasil migrasi penuh dari:
- `Code.gs` (2279 lines) → 18 Supabase Edge Functions
- `index.html` (3446 lines) → Migrated frontend dengan `callApi()` menggantikan `google.script.run`
- Google Sheets → Supabase PostgreSQL dengan 11 tabel

## Teknologi

- **Frontend**: Vanilla HTML/CSS/JS, single-page app
- **Backend**: Supabase Edge Functions (Deno/TypeScript)
- **Database**: Supabase PostgreSQL + Row Level Security
- **Hosting**: GitHub Pages (frontend), Supabase (backend)
- **Notifikasi**: Fonnte WhatsApp API
