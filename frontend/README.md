# Frontend — Kas Monitor

Frontend single-page app untuk Aplikasi Kas Monitor Operasional.

## Struktur

- `index.html` — Aplikasi utama (HTML + CSS + JavaScript)
- `config.js` — Konfigurasi URL API Supabase dan helper `callApi()`

## Cara Deploy

### GitHub Pages

1. Upload folder `frontend/` ke repository GitHub
2. Buka **Settings → Pages**
3. Pilih branch `main`, folder `/frontend`
4. Save — aplikasi akan live di `https://<username>.github.io/<repo>/`

### Vercel / Netlify

1. Deploy folder `frontend/` sebagai static site
2. Tidak perlu build step

## Konfigurasi

Edit `config.js`:

```javascript
const CONFIG = {
  API_URL: "https://[YOUR_PROJECT].supabase.co/functions/v1",
  SUPABASE_URL: "https://[YOUR_PROJECT].supabase.co",
  SUPABASE_ANON_KEY: "[YOUR_ANON_KEY]",
};
```

## Autentikasi

Token JWT disimpan di `localStorage` dengan key `kasmonitor_token`. Login menggunakan endpoint `/api/auth` dengan credentials dari tabel `users`.
