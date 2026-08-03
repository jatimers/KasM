# Design: Kirim Laporan Akhir Hari (PDF) via Email

Tanggal: 2026-08-04
Proyek: KasM (Kas Monitor) — Supabase Edge Functions + GitHub Pages frontend

## Ringkasan

Menambahkan fitur kirim **Laporan Akhir Hari** dalam format PDF melalui email:

1. **Role Admin**: menambah konfigurasi **tujuan email** (Resend API key, alamat pengirim, alamat tujuan email) untuk fitur kirim Laporan Akhir Hari PDF.
2. **Role Teller**: menambah submenu **"Generate & Kirim Laporan Akhir Hari"** berisi filter tanggal (default hari ini) dan tombol trigger kirim laporan harian. Sistem mengekspor data posisi harian kas, rincian saldo khasanah, setoran khasanah, pengeluaran khasanah, dan sisa dalam khasanah ke format PDF, lalu otomatis mengirim email ke tujuan yang dikonfigurasi admin.

## Keputusan yang Sudah Disepakati

- **Email provider**: Resend API (REST API, cocok untuk Deno Edge Functions, free tier).
- **Lokasi setting admin**: menu baru khusus "Tujuan Email Laporan" di bagian ADMINISTRATOR.
- **Cakupan data laporan**: mengikuti `kodeWilayah` dari user teller yang login (bukan ALL).
- **Role dengan submenu kirim**: hanya Teller.
- **Pendekatan**: generate PDF **server-side** di Edge Function (`pdf-lib`), bukan client-side.

## Arsitektur

```
┌──────────────┐  POST /kirim-laporan-harian   ┌──────────────────────────────┐
│  Frontend    │ ─────────────────────────────▶│  Edge Function               │
│  (Teller)    │                               │  kirim-laporan-harian        │
└──────────────┘◀───────────────────────────── │  1. cek auth & role          │
     │            { success, emailId, ... }    │  2. baca setting_email       │
     │                                         │  3. fetch 5 dataset (internal│
     │                                         │     call, service role)      │
     │                                         │  4. generate PDF (pdf-lib)   │
     │                                         │  5. POST api.resend.com/emails│
     │                                         └──────────────────────────────┘
┌──────────────┐  GET/POST /setting-email       ┌──────────────────────────────┐
│  Frontend    │ ─────────────────────────────▶│  Edge Function setting-email │
│  (Admin)     │                               └──────────────────────────────┘
└──────────────┘                                       │ setting_email (tabel)
```

## Backend

### 1. Migration `supabase/migrations/022_setting_email.sql`

```sql
CREATE TABLE IF NOT EXISTS setting_email (
  id SERIAL PRIMARY KEY,
  api_key TEXT NOT NULL DEFAULT '',      -- Resend API key
  from_email TEXT NOT NULL DEFAULT '',   -- pengirim (verified di Resend)
  to_emails TEXT NOT NULL DEFAULT '',    -- tujuan email, bisa lebih dari satu dipisah koma
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE setting_email ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access" ON setting_email
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

Pola mengikuti `setting_wa_gateway` (single row, RLS authenticated). Resend API key disimpan di DB mengikuti konvensi yang sudah ada di project ini.

### 2. Edge Function `setting-email` (`supabase/functions/setting-email/index.ts`)

Pola identik `setting-wa-gateway`:

- **GET**: ambil baris pertama (`order id, limit 1, maybeSingle`). Return `{ apiKey, fromEmail, toEmails }` (strip tanda kutip `'`). Jika kosong return `null`.
- **POST**: upsert single row `{ api_key, from_email, to_emails }` (pakai `cleanStr`). Update baris pertama jika ada, insert jika belum.
- OPTIONS/CORS memakai `corsHeaders` dari `_shared/cors.ts`.

### 3. Edge Function `kirim-laporan-harian` (`supabase/functions/kirim-laporan-harian/index.ts`)

POST, body `{ tanggal, kodeWilayah, userEstim, role, preview? }`.

Langkah:

1. **Auth & role**: aplikasi ini memakai service_role dan tidak memverifikasi JWT (lihat `_shared/supabase.ts`; `setToken` tidak pernah dipanggil saat login). Karena itu identitas dikirim via body: body menyertakan `userEstim` dan `role`. Edge function mencari user di tabel `users` berdasarkan `userEstim`; jika tidak ditemukan → 401. Jika `role` (dari body) maupun role user di DB bukan `teller` atau `admin` → 403.
2. **Baca setting email**: dari tabel `setting_email`. Jika `api_key`, `from_email`, atau `to_emails` kosong → error `"Tujuan email belum diatur oleh admin"`.
3. **Fetch 5 dataset** via internal call memakai service role (`SB_URL` + `SB_SERVICE_ROLE_KEY`), pola sama seperti `notif-wa-gateway`:
   - Posisi Harian Kas: `GET /functions/v1/posisi-kas?action=rekap-harian-global&tanggal=<tgl>&kodeWilayah=<kw>`
   - Rincian Saldo Khasanah: `GET /functions/v1/laporan-ht?action=saldo-kas&tanggal=<tgl>&kodeWilayah=<kw>`
   - Setoran Khasanah: `GET /functions/v1/laporan-ht?action=mutasi&tanggal=<tgl>&kodeWilayah=<kw>&tipeLap=SETOR`
   - Pengeluaran Khasanah: `GET /functions/v1/laporan-ht?action=mutasi&tanggal=<tgl>&kodeWilayah=<kw>&tipeLap=BON`
   - Sisa Dalam Khasanah: `GET /functions/v1/cluis?tanggal=<tgl>&kodeWilayah=<kw>`
4. **Cek data kosong**: jika posisi `userTerdata === 0` dan saldo-kas `grandTotal === 0` → error `"Belum ada data laporan untuk tanggal <tgl>"`.
5. **Generate PDF** memakai `pdf-lib` (`import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@^1.17.1"`):
   - A4 landscape, judul "LAPORAN AKHIR HARI", tanggal (format `formatTglIndo`), wilayah, nama user pengirim.
   - 5 bagian dengan tabel:
     - Posisi Harian Kas (baris: saldo kemarin, penerimaan debet, penerimaan antar, pembayaran kredit, pembayaran antar, saldo hari ini sistem, saldo fisik, selisih).
     - Rincian Saldo Khasanah: (A) rincian pecahan + subtotal per kategori + total HT; (B) cashbox teller; grand total.
     - Setoran Khasanah: rincian pecahan + per teller + total.
     - Pengeluaran Khasanah: rincian pecahan + per teller + total.
     - Sisa Dalam Khasanah (Cluis): lbr & nominal kemarin, pengeluaran, cluis + total global.
   - Pagination otomatis antar bagian (addPage saat melebihi tinggi halaman), footer nomor halaman.
   - Format angka Rupiah: `Rp <angka>.toLocaleString("id-ID")`.
6. **Kirim via Resend**:
   - `POST https://api.resend.com/emails`
   - Header: `Authorization: Bearer <api_key>`, `Content-Type: application/json`
   - Body: `{ from, to: [to_emails dipisah koma], subject: "Laporan Akhir Hari - <tanggal>", html: <ringkasan singkat>, attachments: [{ filename: "Laporan_Akhir_Hari_<tgl>.pdf", content: <base64 pdf> }] }`
7. **Preview mode** (`preview: true`): generate PDF dan return `{ previewPdfBase64, filename }` TANPA mengirim email. Untuk testing.
8. **Return sukses**: `{ emailId, to, totalHT, grandTotal, tanggal }`.

Error handling: semua exception dibungkus try/catch → `errorResponse` 500. Error setting/role/data kosong → 400/403 dengan pesan jelas.

## Frontend

### 1. Menu Admin — halaman `setting-email`

Tambah item menu di `menu-admin` (setelah "⚙️ Notifikasi WA", sekitar line 237):

```html
<div class="menu-item" onclick="nav('setting-email', this); loadSettingEmail();">✉️ Tujuan Email Laporan</div>
```

Halaman baru `#setting-email` (class `page role-page-admin`), mengikuti gaya `#setting-wa-gateway`:
- Form-group: Resend API Key (type password), From Email (pengirim), Tujuan Email (textarea/input, keterangan "lebih dari satu dipisah koma").
- Tombol "💾 SIMPAN PENGATURAN" → `simpanSettingEmail()`.

Fungsi JS baru:
- `loadSettingEmail()` → `google.script.run...getSettingEmail()` (GET `/setting-email`) → isi form.
- `simpanSettingEmail()` → validasi minimal (from & to tidak boleh kosong) → `saveSettingEmail({...})` (POST `/setting-email`) → `showToast(false)`.

### 2. Menu Teller — submenu `kirim-laporan-harian`

Tambah item menu di `menu-teller` (item lurus, mengikuti gaya menu teller yang lain):

```html
<div class="menu-item" onclick="nav('kirim-laporan-harian', this); initKirimLaporanHarian();">✉️ Kirim Laporan Akhir Hari (PDF)</div>
```

Halaman baru `#kirim-laporan-harian` (class `page`):
- Form-row: `<label>Tanggal Laporan</label><input type="date" id="klh-tgl">` (default hari ini).
- Tombol "📤 GENERATE & KIRIM LAPORAN" → `kirimLaporanHarian()`.
- Area hasil `<div id="klh-result">` untuk menampilkan ringkasan (status, email tujuan, grand total) atau error.

Fungsi JS baru:
- `initKirimLaporanHarian()` → set `klh-tgl.value = getLocalDateString()`.
- `kirimLaporanHarian()` → validasi tanggal terisi → `showLoader(true, "Mengirim laporan...")` → `kirimLaporanHarian({ tanggal, kodeWilayah: currentUser.kodeWilayah, userEstim: currentUser.userEstim, role: currentUser.role })` (POST `/kirim-laporan-harian`) → render hasil → `showLoader(false)`. Error ditampilkan via alert/toast.

### 3. Registrasi di `_GAS_MAP` (polyfill)

```js
getSettingEmail:        ['GET','/setting-email'],
saveSettingEmail:       ['POST','/setting-email'],
kirimLaporanHarian:     ['POST','/kirim-laporan-harian'],
```

## Data Flow

1. Teller membuka menu "Kirim Laporan Akhir Hari (PDF)", memilih tanggal (default hari ini), klik tombol kirim.
2. Frontend POST `/kirim-laporan-harian` dengan `{ tanggal, kodeWilayah: currentUser.kodeWilayah, userEstim: currentUser.userEstim, role: currentUser.role }`.
3. Edge function: verifikasi user_estim di tabel `users` + cek role → cek setting email → fetch 5 dataset (internal service role call) → generate PDF → POST Resend API (attachment PDF base64).
4. Return `{ emailId, to, totalHT, grandTotal }` → frontend menampilkan status sukses.

## Error Handling

| Skenario | Perilaku |
|---|---|
| Setting email belum diatur admin | Error: "Tujuan email belum diatur oleh admin." |
| Tidak login / role bukan teller | 401 / 403 |
| Data kosong untuk tanggal | Error: "Belum ada data laporan untuk tanggal X." |
| Gagal kirim Resend | Error menampilkan pesan dari Resend |
| Exception lain | Error 500 |

## Testing

Tidak ada test framework di project ini; verifikasi manual:

1. `supabase functions serve` lokal untuk `setting-email` & `kirim-laporan-harian`.
2. Preview mode (`preview: true`) → cek base64 PDF menghasilkan header + 5 bagian benar.
3. Konfigurasi Resend API key + verified sender → kirim ke email tujuan → cek attachment PDF di inbox.
4. Uji role: admin bisa set email; teller bisa trigger kirim; role lain tidak.
5. Deploy mengikuti README: jalankan migration `022_setting_email.sql`, deploy kedua edge function, push frontend ke GitHub Pages.

## Batasan / Catatan

- Resend API key disimpan di database (`setting_email`) mengikuti konvensi `setting_wa_gateway`.
- Pengirim (from_email) harus email yang sudah diverifikasi di akun Resend.
- Laporan menggunakan wilayah user teller yang login.
- PDF memakai A4 landscape agar tabel cluis (8 kolom) muat.
