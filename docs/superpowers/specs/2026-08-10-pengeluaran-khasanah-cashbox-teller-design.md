# Design: Point B Rincian Pengeluaran Cashbox Teller di Pengeluaran Khasanah

Tanggal: 2026-08-10
Proyek: KasM (Kas Monitor) — Supabase Edge Functions + GitHub Pages frontend

## Ringkasan

Menambahkan **Point B (Rincian Pengeluaran Cashbox Teller)** pada laporan **Pengeluaran Khasanah** di menu `Laporan Akhir Hari`. Saat ini laporan BON hanya menampilkan Point A (total rincian pecahan uang khasanah) dan menyembunyikan bagian per-teller. Setelah perubahan ini:

1. **Point A** (existing) = total rincian pecahan uang khasanah (scope `KHASANAH`) — tidak berubah.
2. **Point B** (baru, hanya BON) = rincian pengeluaran uang cashbox teller berisi **nominal BON PAGI seluruh teller di hari berkenaan (nominal global per teller)**.
3. **Subtotal cashbox teller** (B) dan **grand total A + B** ditampilkan di paling bawah.

## Keputusan yang Disepakati

- **Sumber data Point B**: hanya `tipe = "BON PAGI"` (scope `HEAD TELLER`), dijumlah **global per teller** pada tanggal berkenaan. `BON TAMBAHAN` (scope `KHASANAH`) tetap masuk Point A sebagai uang khasanah.
- **Cakupan perubahan**: layar aplikasi + PDF cetak (`cetakLaporanMutasi`) + PDF email (`kirim-laporan-harian`), karena email memakai `buildLaporanHtml` yang sama.
- **Point A tidak berubah**: tetap aggregasi BON scope `KHASANAH` (rincian pecahan uang khasanah).
- **Teller tanpa BON PAGI**: tidak muncul baris di Point B (cukup agregasi record yang ada).

## Arsitektur & Data Flow

```
┌────────────────────┐  GET /laporan-ht?action=mutasi   ┌────────────────────────────┐
│ Frontend (layar)    │  &tipeLap=BON&tanggal&kodeWilayah│ Edge Function laporan-ht    │
│ loadLapMutasi('BON')│ ───────────────────────────────▶│ 1. rincian (A) = BON scope  │
│                     │◀─────────────────────────────── │    KHASANAH (tidak berubah) │
│  buildLaporanHtml   │  { rincian, total,              │ 2. tellerList (B) = BON     │
│  kind='pengeluaran' │    tellerList, totalTeller }    │    PAGI global per teller   │
└────────────────────┘                                   └────────────────────────────┘
```

## Backend

### 1. `supabase/functions/laporan-ht/index.ts` — action `mutasi`, cabang `else` (BON)

Ubah aggregasi per-teller dari semua BON scope `KHASANAH` menjadi **hanya `tipe === "BON PAGI"`**:

```ts
} else {
  if (tipe === "BON PAGI") {
    const uEstim = cleanStr(row.user_estim);
    tellerCashboxes[uEstim] = (tellerCashboxes[uEstim] || 0) + (parseFloat(String(row.nominal)) || 0);
  }
}
```

Hasilnya `tellerList` berisi per teller: `{ userEstim, namaUnit, total }` (nominal global BON PAGI), dan `totalTeller` = subtotal cashbox teller. `rincian`/`total` (Point A) tetap dihitung dari scope `KHASANAH`.

Catatan: pastikan `isBon` tetap dipakai untuk Point A; variabel `isBon` tidak dihapus.

## Frontend

### 2. `frontend/index.html` — HTML statis section B (baris ~963-965)

Ubah label menjadi dinamis/ID agar bisa di-set per tipe:

- Judul `B. Rincian Per Teller` → diubah saat runtime: BON = `B. Rincian Pengeluaran Cashbox Teller`, SETOR = tetap `B. Rincian Per Teller`.
- Kolom `Nominal Mutasi Transaksi` → saat runtime: BON = `Nominal Bon Pagi`.
- Footer `TOTAL KESELURUHAN TELLER:` → saat runtime: BON = `SUB TOTAL CASHBOX TELLER:`.

### 3. `frontend/index.html` — `loadLapMutasi` (baris ~4405-4492)

- **Jangan sembunyikan** section B untuk BON (hapus/hapus efek `style.display = 'none'` pada heading & tellerWrapper saat `tipe === 'BON'`).
- Set label dinamis heading BON/SETOR pada heading & kolom & footer tabel section B.
- Untuk BON, ganti isi grand box (`#lap-mutasi-grand-box`) menjadi 3 baris:
  1. `TOTAL RINCIAN PECAHAN (A):` → `res.total`
  2. `SUB TOTAL CASHBOX TELLER (B):` → `res.totalTeller`
  3. `GRAND TOTAL PENGELUARAN (A + B):` → `res.total + res.totalTeller`
  - Plus baris terbilang.
- Posisi grand box untuk BON: di bawah tabel section B (teller table) — bukan lagi di bawah tabel pecahan.
- Untuk SETOR, perilaku grand box tetap seperti sekarang (A + B = setoran + teller).

### 4. `frontend/index.html` — `buildLaporanHtml` kind=`pengeluaran` (baris ~1566-1587)

- Bangun `sectionB_Html` untuk `pengeluaran` (sekarang kosong):
  - Heading `B. RINCIAN PENGELUARAN CASHBOX TELLER`
  - Kolom: `Nama Unit Kerja / Cabang | User Estim | Nominal Bon Pagi`
  - Tabel: pakai `buildTellerRows(d.tellerList, 'Tidak ada data rincian teller.', ...)`
  - Footer: `TOTAL KESELURUHAN CASHBOX TELLER (B):` → `formatRpAlign(rawTotalTeller)`
- Ganti `grandTotalHtml` untuk pengeluaran dari 1 baris menjadi:
  - `TOTAL RINCIAN PECAHAN (A):` → `rawTotalMutasi`
  - `SUB TOTAL CASHBOX TELLER (B):` → `rawTotalTeller`
  - `GRAND TOTAL PENGELUARAN (A + B):` → `rawTotalMutasi + rawTotalTeller`
- `grandTotalGabungan` untuk pengeluaran diubah menjadi `rawTotalMutasi + rawTotalTeller` (sebelumnya hanya `rawTotalMutasi`).
- `strTerbilang` dihitung dari `grandTotalGabungan` (sudah otomatis).

## Verifikasi

1. **Backend**: `curl` ke edge function:
   ```
   /laporan-ht?action=mutasi&tanggal=<hari kerja>&kodeWilayah=<kode>&tipeLap=BON
   ```
   → `tellerList` harus berisi BON PAGI per teller (scope HEAD TELLER), `totalTeller` = subtotal cashbox teller, `rincian`/`total` = Point A (uang khasanah).
2. **Layar**: buka menu `Laporan Akhir Hari → Pengeluaran Khasanah`, pilih tanggal kerja. Section B muncul dengan judul cashbox teller + subtotal + grand total A+B di bawah.
3. **PDF cetak**: klik `🖨️ Cetak Rincian PDF / Print` → PDF/print menampilkan section B + grand total A+B.
4. **Email**: submenu Kirim Laporan Harian → attachment `2_Pengeluaran_BON_*.pdf` menampilkan section B + grand total A+B.
