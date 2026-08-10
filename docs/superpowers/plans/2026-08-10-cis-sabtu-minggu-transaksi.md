# CIS Hari Sabtu/Minggu/Libur dengan Transaksi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pada laporan CIS, hari non-kerja (Sabtu/Minggu/libur) yang memiliki record `bon_setor` memakai saldo akhir hari aktual hari itu, bukan carry-forward.

**Architecture:** Edge function `laporan-cib-cis` action `cis` menambah 1 query untuk mendeteksi tanggal-tanggal yang punya transaksi (`bon_setor`), lalu pada post-processing hari non-kerja: jika tanggal itu ber-transaksi dan `rawSaldo[tgl] > 0`, pakai `rawSaldo[tgl]` dan update baseline `lastWorkingDaySaldo`; jika tidak, carry-forward seperti existing.

**Tech Stack:** Deno/TypeScript (Supabase Edge Function), Supabase REST client.

## Global Constraints

- Hanya ubah `supabase/functions/laporan-cib-cis/index.ts` (action `cis`). Frontend tidak diubah.
- Deteksi "ada transaksi" = tabel `bon_setor` punya record apa pun (tipe apa pun) pada tanggal itu, dengan filter `kode_wilayah` bila bukan `"ALL"`.
- Cakupan hari non-kerja = Sabtu/Minggu (`getDay() === 0 || getDay() === 6`) + tanggal dalam `liburSet` (tabel `hari_libur`).
- Hari kerja: perilaku tidak berubah (pakai `rawSaldo`, jika 0 pakai `lastWorkingDaySaldo`).
- Sumber saldo aktual = `rawSaldo[tgl]` dari `laporan-ht?action=saldo-kas` grandTotal (sudah ada).
- Gaya kode existing: ikuti pola di file yang sama (batched fetch, `cleanStr`, template literal).

---

### Task 1: Deteksi tanggal ber-transaksi + post-processing CIS

**Files:**
- Modify: `supabase/functions/laporan-cib-cis/index.ts:156-235` (action `cis`)

**Interfaces:**
- Consumes: `supabase`, `startDate`, `endDate`, `kodeWilayah`, `allDates`, `liburSet`, `rawSaldo`, `lastWorkingDaySaldo`, `grandTotal` — semua sudah ada.
- Produces: `tanggalAdaTransaksi` (Set<string>) dipakai di post-processing; `saldoPerTanggal`/`grandTotal` dengan aturan baru.

- [ ] **Step 1: Tambah query deteksi tanggal ber-transaksi**

Setelah blok `liburSet` (baris 156-162), sebelum blok `rawSaldo` (baris 164), tambahkan:

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

- [ ] **Step 2: Ubah post-processing hari non-kerja**

Ganti blok `if (isWeekend || isLibur) { ... }` di dalam loop utama (baris 224-225) menjadi:

```ts
        if (isWeekend || isLibur) {
          const hasTrx = tanggalAdaTransaksi.has(tgl) && (rawSaldo[tgl] || 0) > 0;
          if (hasTrx) {
            lastWorkingDaySaldo = rawSaldo[tgl];
          }
          saldoPerTanggal[tgl] = lastWorkingDaySaldo;
        } else {
```

Catatan: blok `else` (baris 226-233) dan baris `grandTotal += ...` (baris 234) tidak berubah.

- [ ] **Step 3: Deploy edge function**

```bash
supabase functions deploy laporan-cib-cis --no-verify-jwt
```

(Gunakan stored CLI credential — token di docs sudah expired.)

- [ ] **Step 4: Verifikasi via curl**

```powershell
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"
curl.exe -s -H "apikey: $key" -H "Authorization: Bearer $key" -H "Content-Type: application/json" "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/laporan-cib-cis?action=cis&bulan=2026-07&kodeWilayah=009"
```

Expected untuk 2026-07 (data aktual terverifikasi):
- `2026-07-03` (Jum): 17874430600
- `2026-07-04` (Sab, ada transaksi): **18119476600** (saldo aktual dari `saldo-kas`, bukan carry-forward 17874430600)
- `2026-07-05` (Min, tanpa transaksi): 18119476600 (carry-forward dari Sabtu)
- `2026-07-06` (Sen): nilai `rawSaldo` sendiri (14010451400)
- `2026-07-11` (Sab, tanpa transaksi): carry-forward dari 07-10 (12821524600)
- `2026-07-12` (Min, tanpa transaksi): 12821524600
- `grandTotal` = jumlah semua `saldoPerTanggal`

Juga cek bulan tanpa lembur weekend (mis. `2026-08`) → nilai weekend/libur harus carry-forward (sama dengan perilaku lama).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/laporan-cib-cis/index.ts
git commit -m "feat: CIS hari non-kerja dengan transaksi memakai saldo hari bersangkutan"
```

---

### Task 2: Push ke GitHub

- [ ] **Step 1: Verifikasi & push**

```bash
git status
git log --oneline -4
git push origin main
```

Expected: push sukses; `supabase/functions/laporan-cib-cis/index.ts` masuk `origin/main` (pemicu deploy GitHub Pages, namun edge function hanya berubah di Supabase — deploy sudah dilakukan di Task 1 Step 3).
