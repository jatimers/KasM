# Implementation Plan — Kirim Laporan Akhir Hari via Email (Revisi: Frontend html2pdf)

Date: 2026-08-04
Spec: `docs/superpowers/specs/2026-08-04-laporan-akhir-hari-email-design.md`

## Objective

Fitur "Kirim Laporan Akhir Hari" memungkinkan teller/admin mengirim email berisi 5 PDF laporan harian (Setoran, Pengeluaran/BON, Saldo HT, Sisa Dalam Cluis, Posisi Harian Kas) ke tujuan yang diatur admin. PDF dibuat di browser dari HTML format laporan cetak existing (persis tampilan print manual), dikirim sebagai base64 attachments ke edge function `kirim-laporan-harian` yang tinggal mengirim via Resend.

## Global Constraints

- **Satu sumber render**: `buildLaporanHtml(kind, data, ctx)` menghasilkan string HTML lengkap (termasuk `<style>` dan TTD). Empat fungsi print manual (`cetakLaporanMutasi`, `cetakLaporanHT`, `cetakLapCluis`, `cetakPosisiHarianKas`) DAN alur email sama-sama memakai helper ini. Perilaku & tampilan print manual TIDAK BOLEH berubah.
- **Data mandiri untuk email**: `kirimLaporanHarian()` mem-fetch ulang semua dataset via `_GAS_MAP` (Promise wrapper `_gasProm`) — TIDAK membaca DOM/global state. Dataset: `getDataPejabatHT`, `getRekapPosisiHarianGlobal`, `getLapSaldoKasHariIni`, `getLapMutasiKhasanah` (SETOR & BON), `getLapCluis`.
- **Frontend**: `frontend/index.html` adalah single-file SPA tanpa build step, JS inline (ES6+; async/await & fetch sudah dipakai). `formatRpAlign` (global, line 3262), `terbilang` (line 3244), `formatTglIndo` (line 2795), `showLoader` (line 3258), `showToast` sudah tersedia.
- **Backend**: edge function `kirim-laporan-harian` TIDAK lagi generate PDF dan TIDAK lagi bergantung `pdf-lib`. Ia hanya validasi auth/role/setting + validasi attachments lalu kirim via Resend. Impor `_shared/cors.ts`, `_shared/supabase.ts`, `_shared/utils.ts` tetap dipakai.
- **Auth model**: service_role; frontend kirim `userEstim`+`role` di body; edge function verifikasi ke tabel `users`, `effRole = role === userRole ? role : userRole`, hanya `teller`/`admin` boleh kirim.
- **CDN**: html2pdf.js versi pinned 0.10.0 dari cdnjs. Jangan tambah dependensi lain.
- JANGAN pernah stage/commit `LOG_AKTIVITAS.md`. Jangan ubah fungsi GAS/edge lain di luar yang disebut.
- **Verifikasi**: tidak ada test framework di repo. Verifikasi = manual browser (halaman GitHub Pages + Supabase dashboard logs) + curl untuk edge function. Setiap step wajib diverifikasi sebelum lanjut.
- Deployment perlu internet; gunakan `supabase functions deploy kirim-laporan-harian --no-verify-jwt` (CLI sudah login & link project `jwsfsczgyqphoyflpjnm`). Frontend di-push dulu agar GitHub Pages ter-update.

## Task 1: Sederhanakan edge function `kirim-laporan-harian`

### Purpose

Ubah edge function dari "generate PDF server-side + kirim" menjadi "terima attachments base64 dari frontend + kirim". Menghapus `pdf-lib` dan semua builder PDF yang sekarang redundan, menghilangkan dependency `npm:pdf-lib` dan bug drawLine.

### Files

- Modify: `supabase/functions/kirim-laporan-harian/index.ts` (tulis ulang penuh)

### Steps

#### Step 1.1: Rewrite `index.ts`

Tulis ulang `supabase/functions/kirim-laporan-harian/index.ts` menjadi berikut (hapus `buildReportPdf`, `internalFetch`, `bytesToBase64`, `formatRp`, import pdf-lib):

```ts
// Edge Function: /api/kirim-laporan-harian
// Frontend mengirim laporan akhir hari sebagai lampiran PDF base64 (html2pdf di browser).
// Body: { tanggal, kodeWilayah, userEstim, role, attachments: [{ filename, content }], preview? }

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatTglIndo } from "../_shared/utils.ts";

const RESEND_URL = "https://api.resend.com/emails";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const body = await req.json();
    const tanggal = cleanStr(body.tanggal || "");
    const kodeWilayah = cleanStr(body.kodeWilayah || "ALL");
    const userEstim = cleanStr(body.userEstim || "");
    const role = cleanStr(body.role || "").toLowerCase();
    const preview = !!body.preview;
    const attachments: Array<{ filename?: string; content?: string }> = Array.isArray(body.attachments) ? body.attachments : [];

    if (!tanggal) return errorResponse("Parameter tanggal wajib diisi");

    // 1. Verifikasi user
    const supabase = getSupabaseClient(req);
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("role, nama_user")
      .eq("user_estim", userEstim)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) return errorResponse("User tidak dikenal", 401);
    const userRole = String(user.role || "").toLowerCase();
    const effRole = role === userRole ? role : userRole;
    if (!["teller", "admin"].includes(effRole)) {
      return errorResponse("Role tidak diizinkan mengirim laporan", 403);
    }

    // 2. Setting email
    const { data: setting } = await supabase
      .from("setting_email")
      .select("*")
      .order("id")
      .limit(1)
      .maybeSingle();
    if (!setting || !cleanStr(setting.api_key) || !cleanStr(setting.from_email) || !cleanStr(setting.to_emails)) {
      return errorResponse("Tujuan email belum diatur oleh admin", 400);
    }

    // 3. Validasi lampiran PDF
    const validAttachments: Array<{ filename: string; content: string }> = [];
    let totalBytes = 0;
    for (const a of attachments) {
      if (!a || typeof a.content !== "string" || a.content === "") continue;
      const filename = cleanStr(a.filename) || "Lampiran.pdf";
      try {
        const bytes = decodeBase64(a.content);
        totalBytes += bytes.length;
        if (totalBytes > MAX_ATTACHMENT_BYTES) {
          return errorResponse("Total ukuran lampiran melebihi batas 10 MB", 400);
        }
        validAttachments.push({ filename, content: a.content });
      } catch {
        return errorResponse("Konten lampiran bukan base64 yang valid", 400);
      }
    }
    if (validAttachments.length === 0) {
      return errorResponse("Tidak ada lampiran PDF untuk dikirim", 400);
    }

    if (preview) {
      return successResponse({
        preview: true,
        tanggal,
        kodeWilayah,
        totalAttachment: validAttachments.length,
        filenames: validAttachments.map((a) => a.filename),
      });
    }

    // 4. Kirim email via Resend
    const subject = `Laporan Akhir Hari - ${formatTglIndo(tanggal)}`;
    const html = `<html><body style="font-family:Arial,sans-serif">
      <h2>Laporan Akhir Hari</h2>
      <p>Tanggal: <b>${formatTglIndo(tanggal)}</b></p>
      <p>Wilayah: ${kodeWilayah}</p>
      <p>Dikirim oleh: ${user.nama_user || userEstim}</p>
      <p>Jumlah lampiran: <b>${validAttachments.length}</b> PDF</p>
      </body></html>`;

    const emailResp = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanStr(setting.api_key)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cleanStr(setting.from_email),
        to: cleanStr(setting.to_emails).split(",").map((s: string) => s.trim()).filter(Boolean),
        subject,
        html,
        attachments: validAttachments.map((a) => ({ filename: a.filename, content: a.content })),
      }),
    });

    const emailJson = await emailResp.json().catch(() => ({}));
    if (!emailResp.ok) {
      return errorResponse(`Gagal kirim email: ${emailJson.message || emailResp.statusText || "Resend error"}`, 502);
    }

    return successResponse({
      emailId: emailJson.id || "",
      to: cleanStr(setting.to_emails),
      tanggal,
      totalAttachment: validAttachments.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[kirim-laporan-harian] Exception:", msg);
    return errorResponse("ERROR: " + msg, 500);
  }
});
```

#### Step 1.2: Deploy & test preview mode

Deploy: `supabase functions deploy kirim-laporan-harian --no-verify-jwt`.

Test preview (valid auth tapi tidak kirim email). Gunakan userEstim admin yang ada (mis. `admin`) dan attachments dummy base64 valid (contoh `aGVsbG8=` = "hello"):

```
curl -s -X POST "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/kirim-laporan-harian" -H "Content-Type: application/json" -d '{"tanggal":"2026-08-04","kodeWilayah":"ALL","userEstim":"admin","role":"admin","preview":true,"attachments":[{"filename":"a.pdf","content":"aGVsbG8="}]}'
```

Ekspektasi: `{"success":true,"data":{"preview":true,...,"totalAttachment":1,"filenames":["a.pdf"]}}`.

Test penolakan: tanpa `attachments` → error `Tidak ada lampiran PDF untuk dikirim`. Body bukan base64 (`content:"@@@"`) → error base64 tidak valid.

## Task 2: Frontend — helper `buildLaporanHtml` + refactor 4 fungsi print

### Purpose

Membuat satu sumber render HTML laporan dan refactor keempat fungsi print agar memakai helper, sehingga output print manual identik dan alur email bisa memakai HTML yang sama. Tambahkan CDN html2pdf.js dan globals untuk menyimpan data mentah laporan.

### Files

- Modify: `frontend/index.html`

### Steps

#### Step 2.1: Tambahkan CDN html2pdf.js

Di `frontend/index.html` baris 4, ganti:

```html
  <script src="config.js"></script>
```

menjadi:

```html
  <script src="config.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.0/html2pdf.bundle.min.js"></script>
```

Verifikasi: reload halaman, console menampilkan `typeof html2pdf === 'object'` (bukan undefined).

#### Step 2.2: Tambah globals data mentah + helper Promise

Setelah penutup IIFE proxy GAS (setelah baris 1453, sebelum `let currentUser = {};`), tambahkan:

```js
    function _gasProm(fnName) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function(resolve, reject) {
        var run = google.script.run.withSuccessHandler(resolve);
        run.withFailureHandler(function(err) { reject(new Error((err && err.message) || 'GAS call failed')); });
        run[fnName].apply(run, args);
      });
    }

    function _openPrintWindow(html) {
      var printWindow = window.open('', '', 'width=900,height=650');
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(function() { printWindow.print(); }, 500);
    }
```

Sekaligus (baris 1486) ubah deklarasi global menjadi:

```js
    let globalCluisData = null;
    let globalLapMutasiData = null;
```

Dan (baris 2639) ubah menjadi:

```js
    let dataPosisiHarianTemp = null;
    let globalSaldoKasData = null;
```

Lalu simpan data mentah saat load:
- Dalam success handler `loadLapMutasi` (baris ~4308, tepat setelah `showLoader(false);`) tambahkan baris pertama: `globalLapMutasiData = res;`
- Dalam success handler `loadLapSaldoKas` (baris 4298, tepat setelah `showLoader(false);`) tambahkan baris pertama: `globalSaldoKasData = res;`

Verifikasi: setelah membuka menu Laporan Setoran/Pengeluaran dan Saldo Khasanah HT (data termuat), console `globalLapMutasiData` dan `globalSaldoKasData` berisi objek `{rincian/htRincian, total/totalHT, tellerList, totalTeller, grandTotal?}`.

#### Step 2.3: Implementasi `buildLaporanHtml(kind, data, ctx)`

Tambahkan fungsi global `buildLaporanHtml` tepat setelah `_openPrintWindow` (blok yang sama dengan Step 2.2). Kode lengkap:

```js
    function buildLaporanHtml(kind, data, ctx) {
      var tgl = ctx.tanggal;
      var wilayah = ctx.wilayah;
      var pejabat = ctx.pejabat || {};
      var namaPenyelia = (pejabat && pejabat.namaPenyelia) ? pejabat.namaPenyelia : "______________________";
      var nipPenyelia = (pejabat && pejabat.nipPenyelia) ? "NIP. " + pejabat.nipPenyelia : "NIP. ___________________";
      var namaPBO = (pejabat && pejabat.namaPBO) ? pejabat.namaPBO : "______________________";
      var nipPBO = (pejabat && pejabat.nipPBO) ? "NIP. " + pejabat.nipPBO : "NIP. ___________________";

      var ttd = '<div class="ttd-container"><div class="ttd-box">Mengetahui,<br><b>Pemimpin Bidang Operasional</b><div class="ttd-space"></div><div class="ttd-name">' + namaPBO + '</div><div>' + nipPBO + '</div></div><div class="ttd-box">Dibuat Oleh,<br><b>Penyelia Operasional Dana</b><div class="ttd-space"></div><div class="ttd-name">' + namaPenyelia + '</div><div>' + nipPenyelia + '</div></div></div>';

      function buildRincianRows(rincian, emptyText) {
        var html = "";
        if (!rincian || rincian.length === 0) {
          return '<tr><td colspan="4" style="text-align:center;">' + emptyText + '</td></tr>';
        }
        var currentCat = ""; var subNominal = 0; var subLembar = 0;
        rincian.forEach(function(r, idx) {
          if (currentCat !== "" && currentCat !== r.kategori) {
            html += '<tr style="background-color:#e2e8f0; -webkit-print-color-adjust: exact;"><td colspan="2" style="text-align:right; font-weight:800; color:#0f172a;">Subtotal ' + currentCat + ':</td><td style="text-align:right; font-weight:800; color:#0f172a;">' + subLembar + '</td><td style="font-weight:800;">' + formatRpAlign(subNominal) + '</td></tr>';
            subNominal = 0; subLembar = 0;
          }
          currentCat = r.kategori;
          subNominal += Number(r.nominal) || 0;
          subLembar += Number(r.lembar) || 0;
          html += '<tr><td>' + r.kategori + '</td><td style="font-weight:600;">' + formatRpAlign(r.pecahan) + '</td><td style="text-align:right; font-weight:700;">' + r.lembar + '</td><td style="font-weight:600;">' + formatRpAlign(r.nominal) + '</td></tr>';
          if (idx === rincian.length - 1) {
            html += '<tr style="background-color:#e2e8f0; -webkit-print-color-adjust: exact;"><td colspan="2" style="text-align:right; font-weight:800; color:#0f172a;">Subtotal ' + currentCat + ':</td><td style="text-align:right; font-weight:800; color:#0f172a;">' + subLembar + '</td><td style="font-weight:800;">' + formatRpAlign(subNominal) + '</td></tr>';
          }
        });
        return html;
      }

      function buildTellerRows(tellerList, emptyText, namaUnitStyle) {
        var style = namaUnitStyle || 'font-weight:700;';
        var html = "";
        if (!tellerList || tellerList.length === 0) {
          return '<tr><td colspan="3" style="text-align:center;">' + emptyText + '</td></tr>';
        }
        tellerList.forEach(function(t) {
          html += '<tr><td style="' + style + '">' + t.namaUnit + '</td><td>' + t.userEstim + '</td><td style="font-weight:600;">' + formatRpAlign(t.total) + '</td></tr>';
        });
        return html;
      }

      var css = "";
      var body = "";
      var title = 'Laporan';

      if (kind === 'setoran' || kind === 'pengeluaran') {
        title = kind === 'setoran' ? 'Laporan Rincian Setoran Khasanah' : 'Laporan Rincian Pengeluaran Khasanah (Bon)';
        var tipeLabel = kind === 'setoran' ? 'SETORAN KHASANAH' : 'PENGELUARAN KHASANAH (BON)';
        var isSetoran = kind === 'setoran';
        var d = data || { rincian: [], total: 0, tellerList: [], totalTeller: 0 };
        var rawTotalMutasi = Number(d.total) || 0;
        var rawTotalTeller = Number(d.totalTeller) || 0;
        var grandTotalGabungan = isSetoran ? rawTotalMutasi + rawTotalTeller : rawTotalMutasi;
        var strTerbilang = grandTotalGabungan > 0 ? terbilang(grandTotalGabungan).toUpperCase() + " RUPIAH" : "-";

        var sectionB_Html = "";
        var grandTotalHtml = "";
        if (isSetoran) {
          sectionB_Html = '<h4 style="text-align: left; background:#eee; border:1px solid #000; margin-top:5px;">B. RINCIAN PER TELLER</h4><table><thead><tr><th style="text-align:left;">Nama Unit Kerja / Cabang</th><th style="text-align:left;">User Estim</th><th style="text-align:right;">Nominal Mutasi Transaksi</th></tr></thead><tbody>' + buildTellerRows(d.tellerList, 'Tidak ada data rincian teller.', 'font-weight:700; font-size:0.85rem;') + '</tbody><tfoot><tr><td colspan="2" class="text-right" style="font-weight:bold;">TOTAL KESELURUHAN TELLER (B):</td><td style="font-weight:bold;">' + formatRpAlign(rawTotalTeller) + '</td></tr></tfoot></table>';
          grandTotalHtml = '<div style="display:flex; justify-content:space-between; align-items:center; font-weight:normal; font-size:9px; color:#222; margin-bottom:2px;"><span>TOTAL RINCIAN PECAHAN (A):</span><span>Rp ' + rawTotalMutasi.toLocaleString('id-ID') + '</span></div><div style="display:flex; justify-content:space-between; align-items:center; font-weight:normal; font-size:9px; color:#222; margin-bottom:4px; border-bottom:1px dashed #000; padding-bottom:3px;"><span>TOTAL RINCIAN PER TELLER (B):</span><span>Rp ' + rawTotalTeller.toLocaleString('id-ID') + '</span></div><div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:bold; color:#000;"><span>GRAND TOTAL GABUNGAN (A + B):</span><span style="font-size: 13px;">Rp ' + grandTotalGabungan.toLocaleString('id-ID') + '</span></div>';
        } else {
          grandTotalHtml = '<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:bold; color:#000;"><span>GRAND TOTAL PENGELUARAN KHASANAH:</span><span style="font-size: 13px;">Rp ' + grandTotalGabungan.toLocaleString('id-ID') + '</span></div>';
        }

        css = '@page { size: A4 portrait; margin: 8mm; } body { font-family: "Arial", sans-serif; font-size: 9px; padding: 0; margin: 0; color: #000; } h3 { margin: 1px 0; font-size: 11px; text-align: center; } h4 { margin: 1px 0; font-size: 10px; text-align: center; padding: 2px; } .header { border-bottom: 2px solid #000; padding-bottom: 2px; margin-bottom: 3px; } table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 9px; } th, td { border: 1px solid #000; padding: 2px 4px; } th { background-color: #f2f2f2 !important; -webkit-print-color-adjust: exact; font-weight: bold; text-align: center; } .text-right { text-align: right; } .text-center { text-align: center; } .grand-total { font-size: 11px; font-weight: bold; background: #FFF9C4 !important; border: 2px solid #000; padding: 6px; -webkit-print-color-adjust: exact; margin-top: 8px; } .ttd-container { width: 100%; margin-top: 15px; display: table; } .ttd-box { display: table-cell; width: 50%; text-align: center; vertical-align: bottom; } .ttd-name { font-weight: bold; text-decoration: underline; margin-bottom: 2px; } .ttd-space { height: 40px; }';

        body = '<div class="header"><h3>LAPORAN RINCIAN ' + tipeLabel + '</h3><h4>Wilayah: ' + wilayah + ' | Tanggal: ' + formatTglIndo(tgl) + '</h4></div><h4 style="text-align: left; background:#eee; border:1px solid #000;">A. TOTAL RINCIAN PECAHAN UANG</h4><table><thead><tr><th style="text-align:left;">Kategori</th><th style="text-align:right;">Pecahan</th><th style="text-align:right;">Lembar/Keping</th><th style="text-align:right;">Nominal Total</th></tr></thead><tbody>' + buildRincianRows(d.rincian, 'Tidak ada mutasi.') + '</tbody><tfoot><tr><td colspan="3" class="text-right" style="font-weight:bold;">TOTAL KESELURUHAN (A):</td><td style="font-weight:bold;">' + formatRpAlign(rawTotalMutasi) + '</td></tr></tfoot></table>' + sectionB_Html + '<div class="grand-total">' + grandTotalHtml + '<div style="font-size: 9px; font-style: italic; text-align: right; color: #111; margin-top:4px;">Terbilang: # ' + strTerbilang + ' #</div></div>' + ttd;

      } else if (kind === 'saldo_ht') {
        title = 'Laporan Rincian Saldo Kas dan Cashbox Teller';
        var d = data || { htRincian: [], totalHT: 0, tellerList: [], totalTeller: 0, grandTotal: 0 };
        var rawGrandTotal = Number(d.grandTotal) || 0;
        var strTerbilang = rawGrandTotal > 0 ? terbilang(rawGrandTotal).toUpperCase() + " RUPIAH" : "-";
        var grandTotalHtml = '<div style="display:flex; justify-content:space-between; width:100%;"><span style="color:#d97706; margin-right:20px;">Rp</span><span>' + rawGrandTotal.toLocaleString('id-ID') + '</span></div>';

        css = '@page { size: A4 portrait; margin: 8mm; } body { font-family: "Arial", sans-serif; font-size: 9px; padding: 0; margin: 0; color: #000; } h3 { margin: 1px 0; font-size: 11px; text-align: center; } h4 { margin: 1px 0; font-size: 10px; text-align: center; padding: 2px; } .header { border-bottom: 2px solid #000; padding-bottom: 2px; margin-bottom: 3px; } table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 9px; } th, td { border: 1px solid #000; padding: 2px 4px; } th { background-color: #eee !important; -webkit-print-color-adjust: exact; font-weight: bold; text-align:center;} .text-right { text-align: right; } .text-center { text-align: center; } .grand-total { font-size: 13px; font-weight: bold; background: #FFF9C4 !important; border: 2px solid #000; padding: 4px; -webkit-print-color-adjust: exact; margin-top: 5px; } .ttd-container { width: 100%; margin-top: 10px; display: table; } .ttd-box { display: table-cell; width: 50%; text-align: center; vertical-align: bottom; } .ttd-name { font-weight: bold; text-decoration: underline; margin-bottom: 2px; } .ttd-space { height: 40px; }';

        body = '<div class="header"><h3>LAPORAN RINCIAN SALDO KAS DAN CASHBOX TELLER</h3><h4>Wilayah: ' + wilayah + ' | Tanggal: ' + formatTglIndo(tgl) + '</h4></div><h4 style="text-align: left; background:#eee; border:1px solid #000;">A. TOTAL FISIK SALDO KHASANAH (HT)</h4><table><thead><tr><th style="text-align:left;">Kategori</th><th style="text-align:right;">Pecahan/Ket</th><th style="text-align:right;">Lembar/Keping</th><th style="text-align:right;">Nominal Total</th></tr></thead><tbody>' + buildRincianRows(d.htRincian, 'Khasanah Kosong.') + '</tbody><tfoot><tr><td colspan="3" class="text-right" style="font-weight:bold;">TOTAL SALDO KHASANAH:</td><td style="font-weight:bold;">' + formatRpAlign(d.totalHT) + '</td></tr></tfoot></table><h4 style="text-align: left; background:#eee; border:1px solid #000; margin-top: 5px;">B. SALDO FISIK CASHBOX TELLER (SETOR SORE)</h4><table><thead><tr><th style="text-align:left;">Nama Unit Kerja / Cabang</th><th style="text-align:left;">User Estim</th><th style="text-align:right;">Total Saldo Cashbox</th></tr></thead><tbody>' + buildTellerRows(d.tellerList, 'Belum ada Teller setor sore.') + '</tbody><tfoot><tr><td colspan="2" class="text-right" style="font-weight:bold;">TOTAL KESELURUHAN CASHBOX TELLER:</td><td style="font-weight:bold;">' + formatRpAlign(d.totalTeller) + '</td></tr></tfoot></table><div class="grand-total"><div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #000; padding-bottom:3px; margin-bottom:3px;"><span style="margin-right:20px;">GRAND TOTAL SALDO (HT + Teller):</span><span style="font-size: 15px; min-width:150px; flex-grow:1;">' + grandTotalHtml + '</span></div><div style="font-size: 10px; font-style: italic; text-align: right; color: #111;">Terbilang: ' + strTerbilang + '</div></div>' + ttd;

      } else if (kind === 'cluis') {
        title = 'Sisa Dalam Cluis';
        var d = data || { rincian: [], totalHariSebelumnya: 0, totalPengeluaran: 0, totalCluis: 0 };
        var fmtPrintCluis = function(val, color, weight) {
          var formattedVal = parseInt(val || 0, 10).toLocaleString('id-ID');
          return '<div style="display:flex; justify-content:space-between; align-items:center; width:100%;"><span style="font-weight:normal; margin-right:10px; color:#333;">Rp</span><span style="text-align:right; flex-grow:1; color:' + (color || '#000') + '; font-weight:' + (weight || 'normal') + ';">' + formattedVal + '</span></div>';
        };
        var rowsHtml = "";
        var currentCat = "";
        var subSblm = 0, subPeng = 0, subCluis = 0;
        (d.rincian || []).forEach(function(r, idx) {
          if (currentCat !== "" && currentCat !== r.kategori) {
            rowsHtml += '<tr style="background-color:#e2e8f0; font-weight:bold; -webkit-print-color-adjust: exact;"><td colspan="2" class="text-right">Subtotal ' + currentCat + ':</td><td style="padding:3px 6px;">' + fmtPrintCluis(subSblm) + '</td><td style="padding:3px 6px;">' + fmtPrintCluis(subPeng, '#b91c1c') + '</td><td style="padding:3px 6px;">' + fmtPrintCluis(subCluis, '#047857', 'bold') + '</td></tr>';
            subSblm = 0; subPeng = 0; subCluis = 0;
          }
          currentCat = r.kategori;
          subSblm += Number(r.nominalSebelumnya) || 0;
          subPeng += Number(r.nominalPengeluaran) || 0;
          subCluis += Number(r.nominalCluis) || 0;
          var labelPecahan = isNaN(r.pecahan) ? r.pecahan : parseInt(r.pecahan, 10).toLocaleString('id-ID');
          rowsHtml += '<tr><td>' + r.kategori + '</td><td class="text-right" style="font-weight:600;">' + labelPecahan + '</td><td style="padding:3px 6px;">' + fmtPrintCluis(r.nominalSebelumnya) + ' <span style="font-size:8px; color:#555;">(' + r.lembarSebelumnya + ' lbr)</span></td><td style="padding:3px 6px;">' + fmtPrintCluis(r.nominalPengeluaran, '#b91c1c') + ' <span style="font-size:8px; color:#555;">(' + r.lembarPengeluaran + ' lbr)</span></td><td style="padding:3px 6px;">' + fmtPrintCluis(r.nominalCluis, '#047857', 'bold') + ' <span style="font-size:8px; color:#555;">(' + r.lembarCluis + ' lbr)</span></td></tr>';
          if (idx === d.rincian.length - 1) {
            rowsHtml += '<tr style="background-color:#e2e8f0; font-weight:bold; -webkit-print-color-adjust: exact;"><td colspan="2" class="text-right">Subtotal ' + currentCat + ':</td><td style="padding:3px 6px;">' + fmtPrintCluis(subSblm) + '</td><td style="padding:3px 6px;">' + fmtPrintCluis(subPeng, '#b91c1c') + '</td><td style="padding:3px 6px;">' + fmtPrintCluis(subCluis, '#047857', 'bold') + '</td></tr>';
          }
        });
        if (!d.rincian || d.rincian.length === 0) {
          rowsHtml = '<tr><td colspan="5" style="text-align:center;">Tidak ada riwayat saldo khasanah di tanggal ini.</td></tr>';
        }
        var strTerbilang = d.totalCluis > 0 ? terbilang(d.totalCluis).toUpperCase() + " RUPIAH" : "-";

        css = '@page { size: A4 portrait; margin: 8mm; } body { font-family: "Arial", sans-serif; font-size: 9px; padding: 0; margin: 0; color: #000; } h3 { margin: 1px 0; font-size: 11px; text-align: center; } h4 { margin: 1px 0; font-size: 10px; text-align: center; padding: 2px; } .header { border-bottom: 2px solid #000; padding-bottom: 2px; margin-bottom: 3px; } table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 9px; } th, td { border: 1px solid #000; padding: 3px 5px; } th { background-color: #f2f2f2 !important; -webkit-print-color-adjust: exact; font-weight: bold; text-align: center; } .text-right { text-align: right; font-weight: bold; } .grand-total { font-size: 12px; font-weight: bold; background: #FFF9C4 !important; border: 2px solid #000; padding: 5px; -webkit-print-color-adjust: exact; margin-top: 5px; } .ttd-container { width: 100%; margin-top: 15px; display: table; } .ttd-box { display: table-cell; width: 50%; text-align: center; vertical-align: bottom; } .ttd-name { font-weight: bold; text-decoration: underline; margin-bottom: 2px; } .ttd-space { height: 45px; }';

        body = '<div class="header"><h3>LAPORAN RINCIAN SISA DALAM CLUIS</h3><h4>Wilayah: ' + wilayah + ' | Tanggal: ' + formatTglIndo(tgl) + '</h4></div><h4 style="text-align: left; background:#eee; border:1px solid #000;">PERUBAHAN SALDO KAS CLUIS KHASANAH</h4><table><thead><tr><th style="text-align:left; width:14%;">Kategori</th><th style="text-align:right; width:10%;">Pecahan</th><th style="text-align:right; width:26%;">Saldo Hari Sebelumnya</th><th style="text-align:right; width:25%; color:#b91c1c;">Pengeluaran Hari Ini</th><th style="text-align:right; width:25%; color:#047857;">Sisa Dalam Cluis</th></tr></thead><tbody>' + rowsHtml + '</tbody><tfoot><tr style="font-weight:bold; background:#f2f2f2;"><td colspan="2" class="text-right">TOTAL KESELURUHAN CLUIS:</td><td style="padding:4px 6px;">' + fmtPrintCluis(d.totalHariSebelumnya) + '</td><td style="padding:4px 6px;">' + fmtPrintCluis(d.totalPengeluaran, '#b91c1c') + '</td><td style="padding:4px 6px;">' + fmtPrintCluis(d.totalCluis, '#047857', 'bold') + '</td></tr></tfoot></table><div class="grand-total"><div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #000; padding-bottom:3px; margin-bottom:3px;"><span>GRAND TOTAL SISA DALAM CLUIS:</span><span style="font-size: 14px;">Rp ' + (d.totalCluis || 0).toLocaleString('id-ID') + '</span></div><div style="font-size: 9px; font-style: italic; text-align: right; color: #111;">Terbilang: ' + strTerbilang + '</div></div>' + ttd;

      } else if (kind === 'posisi') {
        title = 'Posisi Harian Kas Operasional';
        var d = data || { userTerdata: 0 };
        var fmtPrintAligned = function(val, color, weight) {
          var formattedVal = parseFloat(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return '<div style="display:flex; justify-content:space-between; align-items:center; width:100%;"><span style="font-weight:normal; margin-right:15px; color:#333;">Rp</span><span style="text-align:right; flex-grow:1; color:' + (color || '#000') + '; font-weight:' + (weight || 'bold') + ';">' + formattedVal + '</span></div>';
        };
        var statusSelisih = d.selisih === 0 ? "BALANCE (KLOP)" : (d.selisih > 0 ? "LEBIH" : "KURANG");
        var strTerbilang = d.saldoFisik > 0 ? terbilang(Math.floor(d.saldoFisik)).toUpperCase() + " RUPIAH" : "-";

        css = '@page { size: A4 portrait; margin: 8mm; } body { font-family: "Arial", sans-serif; font-size: 9px; padding: 0; margin: 0; color: #000; } h3 { margin: 1px 0; font-size: 11px; text-align: center; } h4 { margin: 1px 0; font-size: 10px; text-align: center; padding: 2px; } .header { border-bottom: 2px solid #000; padding-bottom: 2px; margin-bottom: 3px; } table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 9px; } th, td { border: 1px solid #000; padding: 3px 5px; } th { background-color: #eee !important; -webkit-print-color-adjust: exact; font-weight: bold; text-align: center; } .text-right { text-align: right; font-weight: bold; } .text-left { text-align: left; font-weight: 600; } .grand-total { font-size: 13px; font-weight: bold; background: #FFF9C4 !important; border: 2px solid #000; padding: 4px; -webkit-print-color-adjust: exact; margin-top: 5px; } .ttd-container { width: 100%; margin-top: 15px; display: table; } .ttd-box { display: table-cell; width: 50%; text-align: center; vertical-align: bottom; } .ttd-name { font-weight: bold; text-decoration: underline; margin-bottom: 2px; } .ttd-space { height: 40px; }';

        body = '<div class="header"><h3>POSISI HARIAN KAS OPERASIONAL</h3><h4>Wilayah: ' + wilayah + ' | Tanggal: ' + formatTglIndo(tgl) + '</h4></div><table><thead><tr><th style="text-align:left; width:60%;">URAIAN POSISI KAS</th><th style="text-align:right; width:40%;">NOMINAL (RP)</th></tr></thead><tbody><tr><td class="text-left">SALDO KEMARIN HARI</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.saldoKemarin) + '</td></tr><tr><td class="text-left">PENERIMAAN KAS HARI INI ( DEBET )</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.penerimaanDebet, '#0284c7') + '</td></tr><tr><td class="text-left">PENERIMAAN KAS ANTAR TELLER</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.penerimaanAntar, '#0284c7') + '</td></tr><tr><td class="text-left">PEMBAYARAN KAS HARI INI ( KREDIT )</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.pembayaranKredit, '#dc2626') + '</td></tr><tr><td class="text-left">PEMBAYARAN KAS ANTAR TELLER</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.pembayaranAntar, '#dc2626') + '</td></tr><tr style="background:#f1f5f9; -webkit-print-color-adjust: exact;"><td class="text-left" style="font-weight:700;">SALDO HARI INI (SISTEM)</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.saldoHariIni, '#000', '800') + '</td></tr><tr style="background:#f8fafc; -webkit-print-color-adjust: exact;"><td class="text-left" style="font-weight:700;">SALDO KAS MENURUT FISIK UANG</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.saldoFisik, '#000', '800') + '</td></tr><tr><td class="text-left">SELISIH KAS LEBIH / KURANG (' + statusSelisih + ')</td><td style="padding:4px 8px;">' + fmtPrintAligned(d.selisih, d.selisih === 0 ? '#059669' : '#dc2626', '800') + '</td></tr></tbody></table><div class="grand-total"><div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #000; padding-bottom:3px; margin-bottom:3px;"><span>TOTAL SALDO :</span><span style="font-size: 14px;">Rp ' + parseFloat(d.saldoFisik || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span></div><div style="font-size: 9px; font-style: italic; text-align: right; color: #111;">Terbilang Fisik: ' + strTerbilang + '</div></div>' + ttd;
      }

      return '<html><head><title>' + title + '</title><meta charset="utf-8"><style>' + css + '</style></head><body>' + body + '</body></html>';
    }
```

Verifikasi: panggil `buildLaporanHtml('saldo_ht', { htRincian: [{kategori:'Uang Kertas',pecahan:100000,nominal:1000000,lembar:10}], totalHT:1000000, tellerList:[], totalTeller:0, grandTotal:1000000 }, { tanggal:'2026-08-04', wilayah:'Kantor Pusat', pejabat:{} })` di console; hasil string HTML mengandung `TOTAL SALDO KHASANAH` dan `GRAND TOTAL SALDO (HT + Teller)`.

#### Step 2.4: Refactor `cetakLapCluis` dan `cetakPosisiHarianKas`

Ganti seluruh isi `cetakLapCluis` (baris 1545–1659) menjadi:

```js
    function cetakLapCluis() {
      let tgl = document.getElementById('cluis-tgl').value;
      if (!globalCluisData || globalCluisData.rincian.length === 0) { alert('Data kosong atau belum dimuat!'); return; }

      showLoader(true, "Mempersiapkan Lembar PDF Cluis...");
      google.script.run.withSuccessHandler((pejabat) => {
          showLoader(false);
          const html = buildLaporanHtml('cluis', globalCluisData, {
            tanggal: tgl,
            wilayah: currentUser.namaUnit,
            pejabat: pejabat,
          });
          _openPrintWindow(html);
      }).getDataPejabatHT(currentUser.kodeWilayah);
    }
```

Ganti seluruh isi `cetakPosisiHarianKas` (baris 2677–2765) menjadi:

```js
    function cetakPosisiHarianKas() {
      let tgl = document.getElementById('lph-tgl').value;
      if (!dataPosisiHarianTemp || dataPosisiHarianTemp.userTerdata === 0) { alert("Data kosong atau belum ada Teller/KF yang menyimpan Posisi Kas!"); return; }

      showLoader(true, "Menyiapkan Dokumen Laporan...");
      google.script.run.withSuccessHandler((pejabat) => {
        showLoader(false);
        const html = buildLaporanHtml('posisi', dataPosisiHarianTemp, {
          tanggal: tgl,
          wilayah: currentUser.namaUnit,
          pejabat: pejabat,
        });
        _openPrintWindow(html);
      }).getDataPejabatHT(currentUser.kodeWilayah);
    }
```

#### Step 2.5: Refactor `cetakLaporanMutasi` dan `cetakLaporanHT`

Ganti seluruh isi `cetakLaporanMutasi` (baris 4425–4521) menjadi:

```js
    function cetakLaporanMutasi() {
      let tgl = document.getElementById('lap-mutasi-tgl').value;
      if (!tgl) { alert('Pilih tanggal laporan terlebih dahulu!'); return; }
      if (!globalLapMutasiData) { alert('Data laporan belum dimuat!'); return; }
      showLoader(true, "Menyiapkan Dokumen...");
      google.script.run.withSuccessHandler((pejabat) => {
          showLoader(false);
          const kind = window.currentLapMutasiType === 'SETOR' ? 'setoran' : 'pengeluaran';
          const html = buildLaporanHtml(kind, globalLapMutasiData, {
            tanggal: tgl,
            wilayah: currentUser.namaUnit,
            pejabat: pejabat,
          });
          _openPrintWindow(html);
      }).getDataPejabatHT(currentUser.kodeWilayah);
    }
```

Ganti seluruh isi `cetakLaporanHT` (baris 4532 sampai akhir fungsi, sebelum `function showDetail`) menjadi:

```js
    function cetakLaporanHT() {
      let tgl = document.getElementById('lap-sk-tgl').value;
      if (!tgl) { alert('Pilih tanggal laporan terlebih dahulu!'); return; }
      if (!globalSaldoKasData) { alert('Data laporan belum dimuat!'); return; }
      showLoader(true, "Menyiapkan Laporan 1 Halaman...");
      google.script.run.withSuccessHandler((pejabat) => {
          showLoader(false);
          const html = buildLaporanHtml('saldo_ht', globalSaldoKasData, {
            tanggal: tgl,
            wilayah: currentUser.namaUnit,
            pejabat: pejabat,
          });
          _openPrintWindow(html);
      }).getDataPejabatHT(currentUser.kodeWilayah);
    }
```

Verifikasi manual (browser di GitHub Pages):
1. Login admin. Menu "Laporan → Setoran/Pengeluaran": pilih tanggal, klik "Muat Laporan" (data muncul di tabel), lalu "Cetak Laporan". Dialog print muncul, tampilan = format baku existing (header 2 baris, tabel A + subtotal per kategori, B untuk setoran, kotak grand total kuning, TTD). Ulangi untuk tipe BON (tanpa tabel B).
2. Menu "Saldo Khasanah HT": muat, cetak → format baku (A. TOTAL FISIK SALDO KHASANAH, B. SALDO FISIK CASHBOX, GRAND TOTAL).
3. Menu "Sisa Dalam Cluis": muat, cetak → format baku 5 kolom.
4. Menu "Posisi Harian Kas": buka menu (memuat data), cetak → tabel 8 baris + total.
5. Console tidak ada error. Tampilan sama persis dengan sebelum refactor (bandingkan dengan tangkapan lama jika ada).

## Task 3: Frontend — implementasi `kirimLaporanHarian()` baru

### Purpose

Rewrite fungsi kirim agar mem-fetch data, membangun 5 PDF via html2pdf dari `buildLaporanHtml`, mengirim attachments base64 ke edge function, dan menampilkan hasil.

### Files

- Modify: `frontend/index.html`

### Steps

#### Step 3.1: Hapus entri GAS `kirimLaporanHarian` yang tidak terpakai

Di `_GAS_MAP` (baris 1308), hapus baris:

```js
      kirimLaporanHarian:         ['POST','/kirim-laporan-harian'],
```

(fungsi baru memanggil edge function langsung via `fetch`).

#### Step 3.2: Tambah helper `_htmlToPdfBase64`

Tambahkan fungsi berikut tepat setelah `_openPrintWindow` (blok Step 2.2/2.3):

```js
    function _htmlToPdfBase64(html, filename) {
      return new Promise(function(resolve, reject) {
        if (typeof html2pdf === 'undefined') { reject(new Error('Library PDF (html2pdf.js) belum termuat.')); return; }
        var wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.left = '-9999px';
        wrapper.style.top = '0';
        wrapper.style.width = '794px';
        wrapper.style.background = '#ffffff';
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);
        html2pdf().set({
          margin: 0,
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] }
        }).from(wrapper).toPdf().get('pdf').then(function(pdf) {
          if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
          var dataUri = pdf.output('datauristring');
          resolve(dataUri.split(',')[1] || '');
        }).catch(function(err) {
          if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
          reject(err);
        });
      });
    }
```

#### Step 3.3: Rewrite `kirimLaporanHarian()`

Ganti seluruh isi `kirimLaporanHarian` (baris 3770–3792) menjadi:

```js
    async function kirimLaporanHarian() {
      const tgl = document.getElementById('klh-tgl').value;
      if (!tgl) { alert("Pilih tanggal laporan terlebih dahulu!"); return; }
      if (!confirm("Kirim Laporan Akhir Hari untuk tanggal " + tgl + "?\nPDF akan dikirim via email ke tujuan yang diatur admin.")) return;
      if (typeof html2pdf === 'undefined') { alert("Library PDF belum termuat. Periksa koneksi internet lalu muat ulang halaman."); return; }

      showLoader(true, "Mengekspor 5 laporan PDF & mengirim email...");
      document.getElementById('klh-result').innerHTML = '<p style="color:var(--text-muted);">Memproses laporan...</p>';
      try {
        const kodeWilayah = currentUser.kodeWilayah;
        const userEstim = currentUser.userEstim;
        const role = currentUser.role;

        const [pejabat, posisi, saldoKas, setoran, pengeluaran, cluis] = await Promise.all([
          _gasProm('getDataPejabatHT', kodeWilayah),
          _gasProm('getRekapPosisiHarianGlobal', tgl, kodeWilayah),
          _gasProm('getLapSaldoKasHariIni', tgl, kodeWilayah),
          _gasProm('getLapMutasiKhasanah', tgl, kodeWilayah, 'SETOR'),
          _gasProm('getLapMutasiKhasanah', tgl, kodeWilayah, 'BON'),
          _gasProm('getLapCluis', tgl, kodeWilayah),
        ]);

        const ctx = { tanggal: tgl, wilayah: currentUser.namaUnit, pejabat };

        const toAttachment = (kind, data, filename) =>
          _htmlToPdfBase64(buildLaporanHtml(kind, data, ctx), filename).then((content) => ({ filename, content }));

        const attachments = await Promise.all([
          toAttachment('setoran', setoran, '1_Setoran_Khasanah_' + tgl + '.pdf'),
          toAttachment('pengeluaran', pengeluaran, '2_Pengeluaran_BON_' + tgl + '.pdf'),
          toAttachment('saldo_ht', saldoKas, '3_Saldo_Khasanah_HT_' + tgl + '.pdf'),
          toAttachment('cluis', cluis, '4_Sisa_Dalam_Cluis_' + tgl + '.pdf'),
          toAttachment('posisi', posisi, '5_Posisi_Harian_Kas_' + tgl + '.pdf'),
        ]);

        const token = localStorage.getItem('kasmonitor_token') || '';
        const resp = await fetch(_API + '/kirim-laporan-harian', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ tanggal: tgl, kodeWilayah, userEstim, role, attachments }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!json.success) throw new Error(json.error || 'API Error');

        showLoader(false);
        document.getElementById('klh-result').innerHTML =
          `<div class="summary-box" style="background:#ecfdf5; border-left:5px solid #059669; margin-top:10px;">
            <p style="margin:0; font-weight:700; color:#059669;">✅ Laporan berhasil dikirim</p>
            <p style="margin:8px 0 0 0; color:#1e293b;">Tanggal: <b>${json.data.tanggal || tgl}</b><br>Email tujuan: <b>${json.data.to || '-'}</b><br>Jumlah lampiran: <b>${json.data.totalAttachment || attachments.length}</b></p>
          </div>`;
        showToast(false);
      } catch (err) {
        showLoader(false);
        document.getElementById('klh-result').innerHTML =
          `<div class="summary-box" style="background:#fef2f2; border-left:5px solid #dc2626; margin-top:10px;">
            <p style="margin:0; font-weight:700; color:#dc2626;">❌ Gagal mengirim laporan</p>
            <p style="margin:8px 0 0 0; color:#1e293b;">${err.message}</p>
          </div>`;
      }
    }
```

#### Step 3.4: Test end-to-end

Push frontend, tunggu GitHub Actions selesai (Pages menyajikan versi baru).

Test di browser:
1. Login admin → menu "Kirim Laporan Akhir Hari (PDF)".
2. Pastikan setting email sudah ada (menu Admin → Setting Email; jika belum, isi dan simpan dengan to_emails milik tester).
3. Pilih tanggal yang datanya lengkap, klik tombol kirim.
4. Amati: loader "Mengekspor 5 laporan PDF..."; setelah selesai muncul kotak hijau berisi email tujuan & jumlah lampiran 5.
5. Cek inbox tester: 1 email "Laporan Akhir Hari - <tanggal>" dengan 5 attachment PDF (1_Setoran..., 2_Pengeluaran..., 3_Saldo..., 4_Sisa..., 5_Posisi...). Buka tiap PDF: format sama dengan print manual.
6. Uji error: matikan internet lalu klik kirim → muncul kotak merah "Library PDF belum termuat" (atau error fetch).
7. Cek Supabase Dashboard → Edge Functions → kirim-laporan-harian → Logs: tidak ada exception.

## Task 4: Update README

### Purpose

Dokumentasi backend/frontend sesuai arsitektur baru (PDF di browser, edge function hanya kirim).

### Files

- Modify: `README.md`

### Steps

#### Step 4.1: Update struktur & tabel API

1. Baris 39, ganti:
   `│       ├── kirim-laporan-harian/ # POST /api/kirim-laporan-harian (✅ Generate PDF + Kirim Email)` →
   `│       ├── kirim-laporan-harian/ # POST /api/kirim-laporan-harian (✅ Terima PDF base64 & Kirim Email)`
2. Baris 155, ganti:
   `| POST | `/api/kirim-laporan-harian` | Generate PDF Laporan Akhir Hari & kirim email |` →
   `| POST | `/api/kirim-laporan-harian` | Kirim email Laporan Akhir Hari (PDF dibuat di frontend via html2pdf) |`
3. Tambahkan catatan di bawah tabel API Endpoints (setelah baris 163): "PDF Laporan Akhir Hari dibuat di browser memakai html2pdf.js (CDN) dengan format identik cetak manual; edge function hanya memvalidasi dan mengirim via Resend."

Verifikasi: baca ulang README, tidak ada teks lama yang menyebut server-side PDF.

## Task 5: Integration review & final testing

### Purpose

Memastikan seluruh perubahan bekerja bersama, tidak ada regresi pada print manual, dan deploy konsisten.

### Steps

#### Step 5.1: Review diff & konsistensi

- `git diff` review: pastikan hanya file yang direncanakan berubah (`frontend/index.html`, `supabase/functions/kirim-laporan-harian/index.ts`, `README.md`, plan/spec). `LOG_AKTIVITAS.md` tidak boleh masuk.
- Pastikan tidak ada sisa referensi `buildReportPdf`, `pdf-lib`, `internalFetch`, `bytesToBase64` di edge function.
- Pastikan `_GAS_MAP` tidak lagi berisi `kirimLaporanHarian`, dan fungsi `kirimLaporanHarian` (frontend) tidak memanggil `google.script.run.kirimLaporanHarian`.

#### Step 5.2: Uji regresi print manual

Ulangi seluruh verifikasi Step 2.5 di halaman GitHub Pages terbaru: cetak 4 laporan (Setoran, BON, Saldo HT, Cluis, Posisi) — tampilan identik format baku, tidak ada error console.

#### Step 5.3: Uji email final

Kirim ulang laporan via menu (Step 3.4). Verifikasi email tiba dengan 5 lampiran terbaca benar. Konfirmasi ke user.

#### Step 5.4: Commit & push

Setelah semua lolos: stage file yang benar (kecuali `LOG_AKTIVITAS.md`), commit dengan pesan deskriptif (mis. "feat: kirim laporan akhir hari via email — PDF dibangun di frontend (html2pdf)"), push `origin/main`. Jangan create PR kecuali diminta.
