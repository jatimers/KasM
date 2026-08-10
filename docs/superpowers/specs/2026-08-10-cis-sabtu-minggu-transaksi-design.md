# Design: CIS — Hari Sabtu/Minggu/Libur dengan Transaksi Memakai Saldo Hari Bersangkutan

Tanggal: 2026-08-10
Proyek: KasM (Kas Monitor) — Supabase Edge Functions + GitHub Pages frontend

## Ringkasan

Pada laporan **CIS (Saldo Khasanah Harian)**, hari **Sabtu/Minggu** (dan **hari libur**) biasanya memakai carry-forward saldo hari kerja sebelumnya. Namun kadang ada **lembur** di Sabtu/Minggu sehingga terdapat transaksi nyata (BON PAGI, SETOR SORE, dll). Untuk kasus itu, nilai CIS hari bersangkutan harus memakai **saldo akhir hari aktual** hari itu, bukan carry-forward.

Aturan baru:
1. Hari kerja → tidak berubah (pakai `rawSaldo`).
2. Hari **non-kerja (Sabtu/Minggu/libur)** yang **punya record `bon_setor` apa pun** di tanggal itu → pakai `rawSaldo[tgl]` (saldo aktual), lalu jadikan baseline `lastWorkingDaySaldo` untuk hari non-kerja berikutnya.
3. Hari non-kerja **tanpa transaksi** → carry-forward `lastWorkingDaySaldo` (perilaku existing).

## Keputusan yang Disepakati

- **Cakupan hari**: Sabtu/Minggu + semua tanggal di tabel `hari_libur`.
- **Deteksi "ada transaksi"**: tabel `bon_setor` punya record apa pun (tipe apa pun: BON PAGI, SETOR SORE, BON TAMBAHAN, SETOR TAMBAHAN, dll) pada tanggal tersebut, dengan filter `kode_wilayah`.
- **Sumber saldo aktual**: `rawSaldo[tgl]` (grandTotal dari `laporan-ht?action=saldo-kas`) — endpoint yang sama yang sudah dipakai.
- **Hanya backend**: `supabase/functions/laporan-cib-cis/index.ts`. Frontend tidak berubah.

## Arsitektur & Data Flow

```
┌────────────────────┐  GET /laporan-cib-cis?action=cis   ┌──────────────────────────────┐
│ Frontend (CIS)      │  &bulan=YYYY-MM&kodeWilayah        │ Edge Function laporan-cib-cis │
│ loadCis()           │ ─────────────────────────────────▶│ 1. rawSaldo[tgl] per tanggal │
│                     │◀───────────────────────────────── │    (via laporan-ht saldo-kas) │
└────────────────────┘  { saldoPerTanggal, grandTotal,    │ 2. query bon_setor → Set     │
                       }                                   │    tanggalAdaTransaksi       │
                                                           │ 3. post-process: hari non-  │
                                                           │    kerja ber-transaksi pakai │
                                                           │    rawSaldo, update baseline │
                                                           └──────────────────────────────┘
```

## Backend — `supabase/functions/laporan-cib-cis/index.ts` action `cis`

### 1. Deteksi tanggal ber-transaksi

Setelah mengambil `liburData`, tambah query ke `bon_setor` untuk rentang bulan (dengan filter `kode_wilayah` bila bukan `"ALL"`):

```ts
// Detect dates that have any transaction (lembur) — used for weekend/holiday days
let transQ = supabase
  .from("bon_setor")
  .select("tanggal")
  .gte("tanggal", startDate)
  .lte("tanggal", endDate)
  .limit(500000);
if (kodeWilayah !== "ALL") transQ = transQ.eq("kode_wilayah", kodeWilayah);
const { data: transData } = await transQ;

const tanggalAdaTransaksi = new Set<string>();
for (const row of (transData || [])) {
  const tgl = String(row.tanggal).substring(0, 10);
  if (tgl) tanggalAdaTransaksi.add(tgl);
}
```

### 2. Ubah post-processing

Pada loop hari (baris ~218-235), ganti cabang weekend/libur:

```ts
if (isWeekend || isLibur) {
  const hasTrx = tanggalAdaTransaksi.has(tgl) && (rawSaldo[tgl] || 0) > 0;
  if (hasTrx) {
    lastWorkingDaySaldo = rawSaldo[tgl];
    saldoPerTanggal[tgl] = lastWorkingDaySaldo;
  } else {
    saldoPerTanggal[tgl] = lastWorkingDaySaldo;
  }
} else {
  // ... tidak berubah
}
```

Catatan: dengan desain ini, Minggu (tanpa transaksi) setelah Sabtu lembur otomatis ikut saldo Sabtu karena `lastWorkingDaySaldo` sudah di-update.

## Verifikasi

1. **Backend**: `curl` ke edge function untuk bulan dengan kasus lembur weekend:
   ```
   /laporan-cib-cis?action=cis&bulan=2026-07&kodeWilayah=009
   ```
   Expected untuk Juli 2026 (data aktual):
   - 07-03 (Jum): 17.874.430.600
   - 07-04 (Sab, ada transaksi): **18.119.476.600** (saldo aktual, bukan carry-forward)
   - 07-05 (Min, tanpa transaksi): 18.119.476.600 (carry-forward dari Sabtu)
   - 07-06 (Sen): nilai `rawSaldo` sendiri
   - 07-11 (Sab, tanpa transaksi): carry-forward dari 07-10
   - 07-12 (Min, tanpa transaksi): carry-forward dari 07-11
2. **Bulan tanpa lembur weekend** (mis. bulan lain): hasil harus sama persis dengan perilaku lama (carry-forward semua weekend/libur).
3. **Layar**: buka menu Laporan → CIS, pilih bulan → nilai Sabtu/Minggu yang ber-transaksi berbeda dari carry-forward, yang tanpa transaksi tetap ikut hari sebelumnya.
