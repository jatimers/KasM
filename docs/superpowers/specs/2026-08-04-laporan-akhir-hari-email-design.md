# Design: Kirim Laporan Akhir Hari via Email (Format Baku Existing)

Tanggal: 2026-08-04 (revisi)
Proyek: KasM (Kas Monitor) — Supabase Edge Functions + GitHub Pages frontend

## Ringkasan

Menambahkan fitur kirim **Laporan Akhir Hari** melalui email:

1. **Role Admin**: menambah konfigurasi **tujuan email** (Resend API key, alamat pengirim, alamat tujuan email).
2. **Role Teller**: menambah submenu **"Kirim Laporan Akhir Hari"** berisi filter tanggal (default hari ini) dan tombol trigger. Sistem mengirim **satu email berisi 5 attachment PDF** yang formatnya **persis sama dengan laporan yang biasa dicetak manual oleh user** (format baku existing):

   | No | Attachment PDF | Sumber format existing |
   |----|---------------|------------------------|
   | 1 | Laporan Rincian Setoran Khasanah | `cetakLaporanMutasi` (tipe SETOR) |
   | 2 | Laporan Rincian Pengeluaran Khasanah (BON) | `cetakLaporanMutasi` (tipe BON) |
   | 3 | Laporan Saldo Khasanah HT | `cetakLaporanHT` |
   | 4 | Laporan Sisa Dalam Khasanah (CLUIS) | `cetakLapCluis` |
   | 5 | Laporan Posisi Harian Kas | `cetakPosisiHarianKas` |

## Keputusan yang Sudah Disepakati (Revisi)

- **Email provider**: Resend API (tidak berubah).
- **Lokasi setting admin**: menu "Tujuan Email Laporan" di bagian ADMINISTRATOR (sudah selesai, tidak berubah).
- **Cakupan data laporan**: mengikuti `kodeWilayah` dari user teller yang login (tidak berubah).
- **Role dengan submenu kirim**: hanya Teller (tidak berubah).
- **⚠️ REVISI — Pendekatan generate PDF**: TIDAK lagi server-side `pdf-lib`. Sekarang **frontend merender format HTML baku existing → konversi ke PDF via `html2pdf.js` (CDN) di browser → kirim base64 attachment ke edge function** yang tinggal mengirim email. Alasan: user menginginkan attachment berformat persis laporan cetak manual yang sudah baku, dan `pdf-lib` server-side tidak bisa mereproduksi HTML existing dengan setia.

## Arsitektur

```
┌──────────────┐  POST /kirim-laporan-harian      ┌──────────────────────────────┐
│  Frontend    │  { tanggal, kodeWilayah,         │  Edge Function               │
│  (Teller)    │    userEstim, role,              │  kirim-laporan-harian        │
│              │    attachments: [{filename,      │  1. cek auth & role          │
│              │      content(base64)}] }         │  2. baca setting_email       │
│ 1. fetch 6   │ ───────────────────────────────▶ │  3. validasi attachments     │
│    dataset    │◀─────────────────────────────── │  4. POST api.resend.com/emails│
│ 2. build 5   │   { success, emailId, to, ... }  └──────────────────────────────┘
│    HTML baku  │
│ 3. html2pdf  │
└──────────────┘
┌──────────────┐  GET/POST /setting-email          ┌──────────────────────────────┐
│  Frontend    │ ────────────────────────────────▶ │  Edge Function setting-email │
│  (Admin)     │                                   └──────────────────────────────┘
└──────────────┘                                          │ setting_email (tabel)
```

## Backend

### 1. Migration `supabase/migrations/022_setting_email.sql` (sudah selesai, tidak berubah)

```sql
CREATE TABLE IF NOT EXISTS setting_email (
  id SERIAL PRIMARY KEY,
  api_key TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_emails TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE setting_email ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access" ON setting_email
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### 2. Edge Function `setting-email` (sudah selesai, tidak berubah)

GET → ambil baris pertama (`{ apiKey, fromEmail, toEmails }`); POST → upsert single row. Pola `setting-wa-gateway`.

### 3. Edge Function `kirim-laporan-harian` (REVISI — mulai kosong, hapus generator PDF)

POST, body `{ tanggal, kodeWilayah, userEstim, role, attachments?: [{ filename, content }] }`.

Langkah baru:

1. **Auth & role**: sama seperti sebelumnya — cari user di `users` berdasarkan `userEstim` (401 jika tidak ada), `effRole = role === userRole ? role : userRole`, hanya `teller`/`admin` (403). Body `kodeWilayah` dipakai sebagai scope.
2. **Baca setting email**: dari `setting_email`. Jika `api_key`/`from_email`/`to_emails` kosong → 400 `"Tujuan email belum diatur oleh admin"`.
3. **Validasi attachments** (jika `preview` false):
   - `attachments` wajib array tidak kosong → 400 `"Tidak ada lampiran laporan"`.
   - Setiap item: `filename` non-kosong (sanitize, default `lampiran.pdf`), `content` base64 valid.
   - Batas ukuran total ~10 MB (hitung dari panjang base64).
4. **Kirim via Resend**:
   - `POST https://api.resend.com/emails`
   - Header: `Authorization: Bearer <api_key>`, `Content-Type: application/json`
   - Body: `{ from, to: [to_emails dipisah koma], subject: "Laporan Akhir Hari - <formatTglIndo(tanggal)>", html: <ringkasan singkat tanggal/wilayah/pengirim/jumlah lampiran>, attachments }`
5. **Preview mode** (`preview: true`): skip validasi attachments & skip kirim, return `{ preview: true, tanggal, kodeWilayah, totalAttachment: attachments?.length || 0 }`. Untuk testing koneksi/auth tanpa lampiran sungguhan.
6. **Return sukses**: `{ emailId, to, tanggal, totalAttachment }`.

Catatan: hapus import `pdf-lib`, `buildReportPdf`, `bytesToBase64` dari file ini (tidak lagi dipakai server-side). `bytesToBase64` dipindah ke frontend. Internal fetch 5 dataset TIDAK dilakukan di edge function lagi — semua di frontend.

Error handling: try/catch → `errorResponse` 500. Pesan error role/setting/attachment jelas.

## Frontend (REVISI — inti perubahan)

### 1. Halaman Admin `setting-email` (sudah selesai, tidak berubah)

### 2. Halaman Teller `kirim-laporan-harian` (HTML tidak berubah)

Menu, page div (`klh-tgl`, tombol, `klh-result`), `_GAS_MAP` sudah ada. Yang berubah hanya implementasi `kirimLaporanHarian()`.

### 3. Refactor format cetak → satu helper (revisi utama)

**Tujuan**: satu sumber HTML baku yang dipakai print manual DAN email, dijamin identik.

- Tambah `<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/<versi>/html2pdf.bundle.min.js"></script>` (CDN) setelah `config.js`.
- Refactor 4 fungsi cetak existing agar membangun HTML lewat helper `buildLaporanHtml(kind, data, pejabat, ctx)` yang **mengembalikan string HTML** (bukan langsung `window.print()`):
  - `cetakLaporanMutasi` → `buildLaporanHtml('setoran'|'pengeluaran', ...)`
  - `cetakLaporanHT` → `buildLaporanHtml('saldo_ht', ...)`
  - `cetakLapCluis` → `buildLaporanHtml('cluis', ...)`
  - `cetakPosisiHarianKas` → `buildLaporanHtml('posisi_harian', ...)`
- Fungsi cetak manual tetap membuka print window dengan HTML dari helper → **perilaku print manual tidak berubah**.
- Helper menerima data mentah (bukan dari DOM) sehingga bisa dipakai email. Konteks (`ctx`) berisi `tanggal`, `wilayah`, `namaUser`, `userEstim`, `pejabat` (namaPenyelia/nipPenyelia/namaPBO/nipPBO).

### 4. Implementasi baru `kirimLaporanHarian()`

1. Validasi tanggal terisi.
2. `showLoader(true, "Menyiapkan 5 lampiran PDF...")`.
3. **Fetch 6 dataset paralel** via `_GAS_MAP` (endpoint sudah ada):
   - `getDataPejabatHT(currentUser.kodeWilayah)` → pejabat
   - `getRekapPosisiHarianGlobal(tanggal, currentUser.kodeWilayah)` → posisi
   - `getLapSaldoKasHariIni(tanggal, currentUser.kodeWilayah)` → saldo kas
   - `getLapMutasiKhasanah(tanggal, currentUser.kodeWilayah, 'SETOR')` → setoran
   - `getLapMutasiKhasanah(tanggal, currentUser.kodeWilayah, 'BON')` → pengeluaran
   - `getLapCluis(tanggal, currentUser.kodeWilayah)` → cluis
   - Cek data kosong: jika posisi kosong DAN saldo-kas kosong → alert `"Belum ada data laporan untuk tanggal X"`.
4. **Bangun 5 HTML** via `buildLaporanHtml` dengan data hasil fetch.
5. **Konversi tiap HTML → PDF** via `html2pdf()` (opsi: format A4 sesuai orientasi masing-masing laporan — sebagian portrait, tabularis A3 landscape — sesuaikan dengan `@page` yang sudah dipakai masing-masing fungsi cetak). Kumpulkan `{ filename, content: base64 }`.
6. **POST** `kirimLaporanHarian({ tanggal, kodeWilayah: currentUser.kodeWilayah, userEstim: currentUser.userEstim, role: currentUser.role, attachments })`.
7. Render hasil ke `#klh-result` (emailId, to, totalAttachment) atau error. `showLoader(false)` + `showToast(false)`.

Catatan orientasi per laporan (mengikuti fungsi cetak existing):
- Setoran / Pengeluaran / Saldo HT / CLUIS: A4 **portrait** (`@page { size: A4 portrait; margin: 8mm; }`).
- Posisi Harian Kas: ikuti `@page` fungsi `cetakPosisiHarianKas` yang sudah ada.

## Data Flow

1. Teller buka "Kirim Laporan Akhir Hari", pilih tanggal, klik tombol.
2. Frontend fetch 6 dataset → build 5 HTML baku → html2pdf → POST `kirim-laporan-harian` dengan attachments base64.
3. Edge function verifikasi user/role + setting email + validasi attachments → POST Resend (5 lampiran).
4. Return `{ emailId, to, totalAttachment }` → frontend tampilkan status.

## Error Handling

| Skenario | Perilaku |
|---|---|
| Setting email belum diatur admin | Error: "Tujuan email belum diatur oleh admin." |
| Tidak login / role bukan teller | 401 / 403 |
| Data kosong untuk tanggal | Alert: "Belum ada data laporan untuk tanggal X." (frontend) |
| Salah satu fetch dataset gagal | Alert pesan error (frontend) |
| Gagal kirim Resend | Error menampilkan pesan dari Resend |
| Attachment kosong / terlalu besar | Error: "Tidak ada lampiran laporan" / pesan ukuran |
| Exception lain | Error 500 |

## Testing

Tidak ada test framework; verifikasi manual:

1. Konfigurasi Resend API key + verified sender → kirim ke email tujuan → cek 5 attachment PDF di inbox, formatnya sama persis dengan cetak manual.
2. Bandingkan output print manual vs attachment email (visual).
3. Uji role: admin bisa set email; teller bisa trigger kirim; role lain tidak.
4. Uji data kosong & fetch gagal (tanggal tanpa data).
5. Deploy mengikuti README (migration + 2 edge function + push frontend).

## Batasan / Catatan

- Resend API key disimpan di database (`setting_email`).
- Pengirim (from_email) harus verified di akun Resend.
- Attachment dibuat client-side → bergantung html2pdf.js CDN (harus tersedia di browser user saat kirim).
- Karena PDF dibuat di browser, orientasi/halaman mengikuti CSS `@page` fungsi cetak existing.
