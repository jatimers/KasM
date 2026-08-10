# Point B Rincian Cashbox Teller di Pengeluaran Khasanah — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah Point B (rincian pengeluaran cashbox teller = BON PAGI global per teller), subtotal cashbox teller, dan grand total A+B pada laporan Pengeluaran Khasanah — di layar, PDF cetak, dan PDF email.

**Architecture:** Backend edge function `laporan-ht?action=mutasi` mengubah aggregasi per-teller untuk tipe BON agar hanya menjumlah `tipe === "BON PAGI"` (scope `HEAD TELLER`) per teller → `tellerList`/`totalTeller` menjadi rincian cashbox teller. Frontend membuka kembali section B yang selama ini disembunyikan untuk BON, melabelinya ulang, menampilkan subtotal, dan menampilkan grand total A+B pada layar maupun `buildLaporanHtml` kind=`pengeluaran` (dipakai PDF cetak & email).

**Tech Stack:** Deno/TypeScript (Supabase Edge Function), vanilla JS single-file frontend (`frontend/index.html`), Supabase REST API.

## Global Constraints

- Frontend aktif = `frontend/index.html` (deploy GitHub Pages memakai folder `frontend`). **Jangan** ubah `index.html` di root.
- Endpoint backend = `supabase/functions/laporan-ht/index.ts`, action `mutasi`, param `tipeLap` bernilai `"SETOR"` atau `"BON"`.
- Point A (`rincian`/`total`) untuk BON **tidak boleh berubah**: tetap hanya scope `KHASANAH`.
- Data sumber Point B = hanya `tipe === "BON PAGI"`; `BON TAMBAHAN` tetap di Point A.
- Perilaku SETOR tidak berubah (label "B. Rincian Per Teller", grand total A+B setoran).
- Ikuti gaya kode existing: string concat dengan `+` (bukan template literal) di `buildLaporanHtml`, template literal backtick di `loadLapMutasi`, helper `formatRpAlign`, `terbilang`, `buildRincianRows`, `buildTellerRows`.
- Tidak ada framework test/typecheck di repo; verifikasi via curl ke edge function + inspeksi manual browser.

---

### Task 1: Backend — aggregasi BON PAGI per teller di `laporan-ht`

**Files:**
- Modify: `supabase/functions/laporan-ht/index.ts:228-239` (blok "Per teller tracking")

**Interfaces:**
- Consumes: `bonData` (array baris `bon_setor`), `kodeWilayah`, `tipeLap`, `cleanStr`, `userMap`, `normalizeUnit` — semua sudah ada.
- Produces: untuk `tipeLap === "BON"`, `tellerCashboxes` berisi per teller jumlah nominal **BON PAGI** (scope `HEAD TELLER`); `tellerList`/`totalTeller` (subtotal cashbox teller) otomatis terhitung dari map itu di kode existing (baris 254-263). `rincian`/`total` (Point A) tidak tersentuh.

- [ ] **Step 1: Ubah blok "Per teller tracking"**

Ganti branch `else` (baris 234-239) sehingga hanya `BON PAGI` yang diakumulasi per teller:

```ts
        } else {
          if (tipe === "BON PAGI") {
            const uEstim = cleanStr(row.user_estim);
            tellerCashboxes[uEstim] = (tellerCashboxes[uEstim] || 0) + (parseFloat(String(row.nominal)) || 0);
          }
        }
```

Jangan ubah `isBon`/`isSetor` (masih dipakai untuk Point A). Biarkan branch SETOR (baris 229-233) tetap.

- [ ] **Step 2: Deploy edge function**

```bash
$env:SUPABASE_ACCESS_TOKEN = "<SUPABASE_ACCESS_TOKEN>"
supabase link --project-ref jwsfsczgyqphoyflpjnm
supabase functions deploy laporan-ht --no-verify-jwt
```

- [ ] **Step 3: Verifikasi via curl**

Ambil tanggal kerja yang punya data (contoh `2026-08-03`, wilayah `009`). Jalankan dari PowerShell:

```powershell
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"
curl.exe -s -H "apikey: $key" -H "Authorization: Bearer $key" -H "Content-Type: application/json" "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/laporan-ht?action=mutasi&tanggal=2026-08-03&kodeWilayah=009&tipeLap=BON"
```

Expected: `tellerList` berisi beberapa teller (IP02/IP04/IP05/IP06/IP07/IP09/IP10) dengan nominal masing-masing sesuai BON PAGI hari itu, `totalTeller` = subtotal cashbox teller, `rincian`/`total` tetap = uang khasanah (scope KHASANAH). Bandingkan juga `tipeLap=SETOR` — hasilnya tidak berubah dari sebelumnya.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/laporan-ht/index.ts
git commit -m "feat: laporan-ht mutasi BON aggregasi BON PAGI per teller untuk Point B cashbox teller"
```

---

### Task 2: Frontend — section B statis siap dilabel ulang

**Files:**
- Modify: `frontend/index.html:963-965` (heading B + tabel teller)

**Interfaces:**
- Consumes: tidak ada.
- Produces: elemen dengan ID baru `lap-mutasi-b-title` (heading), `lap-mutasi-teller-col` (th kolom nominal), `lap-mutasi-teller-label` (td label footer). Dipakai Task 3.

- [ ] **Step 1: Beri ID pada elemen statis section B**

Ubah baris 963:

```html
        <h4 id="lap-mutasi-b-title" style="border-bottom: 2px solid #0284c7; color:#0284c7; padding-bottom:8px; margin-top:25px;">B. Rincian Per Teller</h4>
```

Ubah baris 965 (kolom header ketiga + label footer):

```html
          <table><thead><tr><th style="text-align:left;">Nama Unit Kerja / Cabang</th><th style="text-align:left;">User Estim</th><th id="lap-mutasi-teller-col" style="text-align:right;">Nominal Mutasi Transaksi</th></tr></thead><tbody id="lap-mutasi-teller-body"><tr><td colspan="3" style="text-align:center;">Pilih tanggal.</td></tr></tbody><tfoot><tr><td id="lap-mutasi-teller-label" colspan="2" style="text-align:right;">TOTAL KESELURUHAN TELLER:</td><td id="lap-mutasi-teller-total" style="text-align:right; font-size:1.1rem; color:#0284c7;">Rp 0</td></tr></tfoot></table>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/index.html
git commit -m "feat: tambah id dinamis pada section B laporan mutasi"
```

---

### Task 3: Frontend — `loadLapMutasi` tampilkan & label ulang section B, grand box A+B

**Files:**
- Modify: `frontend/index.html:4405-4492` (handler sukses `loadLapMutasi`)

**Interfaces:**
- Consumes: `res` dari `getLapMutasiKhasanah` (`{ rincian, total, tellerList, totalTeller }`), `tipe` (`"SETOR"`/`"BON"`), `formatRpAlign`, `terbilang`, elemen ID dari Task 2.
- Produces: section B terlihat untuk BON dengan label cashbox teller; grand box BON menampilkan A, subtotal B, grand total A+B.

- [ ] **Step 1: Hentikan penyembunyian section B untuk BON**

Ganti blok selector heading + wrapper (baris 4422-4431). Hapus penyembunyian, dan untuk BON set label ulang:

```js
        // --- LABEL SECTION B SESUAI TIPE LAPORAN ---
        let bTitle = document.getElementById('lap-mutasi-b-title');
        if (bTitle) bTitle.textContent = tipe === 'BON' ? 'B. Rincian Pengeluaran Cashbox Teller' : 'B. Rincian Per Teller';
        let bCol = document.getElementById('lap-mutasi-teller-col');
        if (bCol) bCol.textContent = tipe === 'BON' ? 'Nominal Bon Pagi' : 'Nominal Mutasi Transaksi';
        let bLabel = document.getElementById('lap-mutasi-teller-label');
        if (bLabel) bLabel.textContent = tipe === 'BON' ? 'SUB TOTAL CASHBOX TELLER:' : 'TOTAL KESELURUHAN TELLER:';
```

Hapus `document.querySelectorAll(...)` hide loop dan `tellerWrapper.style.display = tipe === 'BON' ? 'none' : 'block'` (baris 4423-4431). Pertahankan penemuan `tellerWrapper`/`tellerTable` (baris 4418-4420) karena masih dipakai untuk penempatan grand box.

- [ ] **Step 2: Ubah grand box BON menjadi 3 baris + letakkan di bawah tabel B**

Ganti blok `if(tipe === 'BON') { ... }` (baris 4446-4464) menjadi:

```js
        if(tipe === 'BON') {
          let grandTotalPengeluaran = (Number(res.total) || 0) + (Number(res.totalTeller) || 0);
          grandBox.style.background = '#fee2e2'; 
          grandBox.style.border = '1px solid #fca5a5';
          if (tellerWrapper) {
            tellerWrapper.parentNode.insertBefore(grandBox, tellerWrapper.nextSibling);
          } else if (tellerTable) {
            tellerTable.parentNode.insertBefore(grandBox, tellerTable.nextSibling);
          } else if (pecWrapper) {
            pecWrapper.parentNode.insertBefore(grandBox, pecWrapper.nextSibling);
          }

          grandBox.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; color:#475569; font-size:0.95rem; margin-bottom:5px;">
              <span>Total Rincian Pecahan (A):</span>
              <span>Rp ${(Number(res.total)||0).toLocaleString('id-ID')}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; color:#475569; font-size:0.95rem; margin-bottom:6px; border-bottom:1px dashed #fca5a5; padding-bottom:6px;">
              <span>Sub Total Cashbox Teller (B):</span>
              <span>Rp ${(Number(res.totalTeller)||0).toLocaleString('id-ID')}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-weight:800; color:#b91c1c; font-size:1.1rem;">
              <span>GRAND TOTAL PENGELUARAN (A + B):</span>
              <span>Rp ${grandTotalPengeluaran.toLocaleString('id-ID')}</span>
            </div>
            <div style="font-size:0.85rem; font-style:italic; text-align:right; color:#991b1b; margin-top:4px; font-weight:600;">
              Terbilang: # ${terbilang(grandTotalPengeluaran).toUpperCase()} RUPIAH #
            </div>
          `;
        } else {
```

Catatan: untuk SETOR, blok `else` (baris 4465-4491) tetap tidak berubah.

- [ ] **Step 3: Verifikasi manual di browser**

Buka `frontend/index.html` (mis. via GitHub Pages atau file server). Login dengan role HT, buka menu `Laporan Akhir Hari` → `Pengeluaran Khasanah`, pilih tanggal kerja (mis. 2026-08-03).
Expected: section B muncul dengan judul "B. Rincian Pengeluaran Cashbox Teller", kolom "Nominal Bon Pagi", footer "SUB TOTAL CASHBOX TELLER:", grand box di bawah tabel B berisi Total A, Sub Total B, Grand Total A+B + terbilang.
Buka juga `Setoran Khasanah` → label/format tetap seperti sebelumnya (B. Rincian Per Teller, grand total setoran).

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html
git commit -m "feat: tampilkan Point B cashbox teller + grand total A+B di Pengeluaran Khasanah"
```

---

### Task 4: Frontend — `buildLaporanHtml` kind=`pengeluaran` tambah section B & grand total A+B

**Files:**
- Modify: `frontend/index.html:1566-1587` (blok `kind === 'setoran' || kind === 'pengeluaran'`)

**Interfaces:**
- Consumes: `data` = `{ rincian, total, tellerList, totalTeller }` dari `globalLapMutasiData` (layar) atau `pengeluaran` (email); helper `buildTellerRows`, `formatRpAlign`, `terbilang`.
- Produces: PDF cetak (`cetakLaporanMutasi`) dan PDF email (`kirim-laporan-harian` attachment `2_Pengeluaran_BON_*.pdf`) menampilkan section B + grand total A+B.

- [ ] **Step 1: Ubah perhitungan grand total & bangun section B untuk pengeluaran**

Ganti baris 1573 dan 1576-1583 menjadi:

```js
        var grandTotalGabungan = rawTotalMutasi + rawTotalTeller;
        var strTerbilang = grandTotalGabungan > 0 ? terbilang(grandTotalGabungan).toUpperCase() + " RUPIAH" : "-";

        var sectionB_Html = "";
        var grandTotalHtml = "";
        if (isSetoran) {
          sectionB_Html = '<h4 style="text-align: left; background:#eee; border:1px solid #000; margin-top:5px;">B. RINCIAN PER TELLER</h4><table><thead><tr><th style="text-align:left;">Nama Unit Kerja / Cabang</th><th style="text-align:left;">User Estim</th><th style="text-align:right;">Nominal Mutasi Transaksi</th></tr></thead><tbody>' + buildTellerRows(d.tellerList, 'Tidak ada data rincian teller.', 'font-weight:700; font-size:0.85rem;') + '</tbody><tfoot><tr><td colspan="2" class="text-right" style="font-weight:bold;">TOTAL KESELURUHAN TELLER (B):</td><td style="font-weight:bold;">' + formatRpAlign(rawTotalTeller) + '</td></tr></tfoot></table>';
          grandTotalHtml = '<div style="display:flex; justify-content:space-between; align-items:center; font-weight:normal; font-size:9px; color:#222; margin-bottom:2px;"><span>TOTAL RINCIAN PECAHAN (A):</span><span>Rp ' + rawTotalMutasi.toLocaleString('id-ID') + '</span></div><div style="display:flex; justify-content:space-between; align-items:center; font-weight:normal; font-size:9px; color:#222; margin-bottom:4px; border-bottom:1px dashed #000; padding-bottom:3px;"><span>TOTAL RINCIAN PER TELLER (B):</span><span>Rp ' + rawTotalTeller.toLocaleString('id-ID') + '</span></div><div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:bold; color:#000;"><span>GRAND TOTAL GABUNGAN (A + B):</span><span style="font-size: 13px;">Rp ' + grandTotalGabungan.toLocaleString('id-ID') + '</span></div>';
        } else {
          sectionB_Html = '<h4 style="text-align: left; background:#eee; border:1px solid #000; margin-top:5px;">B. RINCIAN PENGELUARAN CASHBOX TELLER</h4><table><thead><tr><th style="text-align:left;">Nama Unit Kerja / Cabang</th><th style="text-align:left;">User Estim</th><th style="text-align:right;">Nominal Bon Pagi</th></tr></thead><tbody>' + buildTellerRows(d.tellerList, 'Tidak ada data rincian teller.', 'font-weight:700; font-size:0.85rem;') + '</tbody><tfoot><tr><td colspan="2" class="text-right" style="font-weight:bold;">TOTAL KESELURUHAN CASHBOX TELLER (B):</td><td style="font-weight:bold;">' + formatRpAlign(rawTotalTeller) + '</td></tr></tfoot></table>';
          grandTotalHtml = '<div style="display:flex; justify-content:space-between; align-items:center; font-weight:normal; font-size:9px; color:#222; margin-bottom:2px;"><span>TOTAL RINCIAN PECAHAN (A):</span><span>Rp ' + rawTotalMutasi.toLocaleString('id-ID') + '</span></div><div style="display:flex; justify-content:space-between; align-items:center; font-weight:normal; font-size:9px; color:#222; margin-bottom:4px; border-bottom:1px dashed #000; padding-bottom:3px;"><span>SUB TOTAL CASHBOX TELLER (B):</span><span>Rp ' + rawTotalTeller.toLocaleString('id-ID') + '</span></div><div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:bold; color:#000;"><span>GRAND TOTAL PENGELUARAN (A + B):</span><span style="font-size: 13px;">Rp ' + grandTotalGabungan.toLocaleString('id-ID') + '</span></div>';
        }
```

`body` (baris 1587) tidak perlu diubah — sudah menggabungkan `sectionB_Html` dan `grandTotalHtml`.

- [ ] **Step 2: Verifikasi PDF cetak & email**

Layar Pengeluaran Khasanah → klik `🖨️ Cetak Rincian PDF / Print` → PDF berisi section B "B. RINCIAN PENGELUARAN CASHBOX TELLER" + kolom "Nominal Bon Pagi" + "TOTAL KESELURUHAN CASHBOX TELLER (B)" + grand total A+B + terbilang.
Submenu Kirim Laporan Harian → email attachment `2_Pengeluaran_BON_<tgl>.pdf` menampilkan hal yang sama.
Cek juga PDF Setoran (attachment `1_Setoran_*.pdf`) tetap seperti sebelumnya.

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat: buildLaporanHtml pengeluaran tambah section B cashbox teller + grand total A+B"
```

---

### Task 5: Push ke GitHub

- [ ] **Step 1: Verifikasi perubahan & push**

```bash
git status
git log --oneline -6
git push origin main
```

Expected: push sukses; `frontend/index.html` & `supabase/functions/laporan-ht/index.ts` masuk ke `origin/main` (pemicu auto-deploy GitHub Pages).
