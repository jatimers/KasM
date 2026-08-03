# Kirim Laporan Akhir Hari (PDF) via Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan fitur kirim Laporan Akhir Hari (PDF) via email: admin mengonfigurasi tujuan email (Resend), teller men-trigger generate PDF + kirim email.

**Architecture:** Satu Edge Function baru `kirim-laporan-harian` mengambil 5 dataset laporan via internal call ke endpoint yang sudah ada, membangun PDF A4 landscape memakai `pdf-lib` (npm specifier Deno), lalu mengirim via Resend REST API dengan PDF sebagai attachment. Konfigurasi email admin disimpan di tabel baru `setting_email` dan dikelola lewat Edge Function `setting-email`.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), `npm:pdf-lib@1.17.1`, Resend API, vanilla HTML/JS frontend, PostgreSQL RLS.

**Referensi desain:** `docs/superpowers/specs/2026-08-04-laporan-akhir-hari-email-design.md`

## Global Constraints

- Role yang boleh trigger kirim: hanya `teller` atau `admin` (validasi server-side via tabel `users`).
- Cakupan data laporan = `kodeWilayah` user teller yang login.
- Setting email disimpan sebagai single row di tabel `setting_email` (pola `setting_wa_gateway`).
- Pendekatan auth aplikasi ini memakai service_role dan TIDAK memverifikasi JWT; identitas dikirim via body (`userEstim`, `role`).
- Format angka Rupiah: `"Rp " + n.toLocaleString("id-ID")`.
- PDF memakai A4 landscape (842x595 pt), margin 30 pt, font Helvetica.
- Semua edge function mengikuti pola `corsHeaders`/`successResponse`/`errorResponse` dari `_shared/cors.ts` dan helper `cleanStr`, `formatTglIndo`, `getSupabaseClient` dari `_shared/`.
- Tidak ada test framework di project ini; verifikasi manual via `supabase functions serve` + curl (membutuhkan Docker + file `.env` berisi `SB_URL` dan `SB_SERVICE_ROLE_KEY`), atau review kode jika Docker tidak tersedia.

---

### Task 1: Migration tabel `setting_email`

**Files:**
- Create: `supabase/migrations/022_setting_email.sql`

**Interfaces:**
- Consumes: pola tabel `setting_wa_gateway` (`supabase/migrations/016_wa_gateway.sql`)
- Produces: tabel `setting_email` dengan kolom `id`, `api_key`, `from_email`, `to_emails`, `created_at`; RLS `authenticated` ALL (dipakai Task 2 dan Task 3)

- [ ] **Step 1: Buat file migration**

```sql
-- =============================================
-- MIGRASI: Setting Email Laporan Akhir Hari (Resend)
-- File: 022_setting_email.sql
-- =============================================

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

- [ ] **Step 2: Verifikasi file**

Run: `Get-Content supabase/migrations/022_setting_email.sql`
Expected: 3 pernyataan SQL (CREATE TABLE, ALTER TABLE, CREATE POLICY) sesuai di atas.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_setting_email.sql
git commit -m "feat: migration tabel setting_email untuk tujuan email laporan harian"
```

**Catatan deploy:** Migration dijalankan manual di Supabase SQL Editor (bukan via CLI), sesuai cara setup project di `README.md` (copy-paste isi file ke SQL Editor lalu Run). Juga bisa `supabase db push` jika project sudah dilink.

---

### Task 2: Edge Function `setting-email`

**Files:**
- Create: `supabase/functions/setting-email/index.ts`

**Interfaces:**
- Consumes: `setting_email` tabel (Task 1); helper `corsHeaders`, `successResponse`, `errorResponse` dari `../_shared/cors.ts`; `getSupabaseClient` dari `../_shared/supabase.ts`; `cleanStr` dari `../_shared/utils.ts`
- Produces: endpoint `GET /setting-email` → `{ apiKey, fromEmail, toEmails }` atau `null`; `POST /setting-email` → `true` (upsert single row). Dipakai frontend Task 4.

- [ ] **Step 1: Buat file edge function**

```ts
// Edge Function: /api/setting-email
// Konfigurasi tujuan email untuk kirim Laporan Akhir Hari PDF (Resend)

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);

    // GET
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("setting_email")
        .select("*")
        .order("id")
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return successResponse(null);

      return successResponse({
        apiKey: String(data.api_key || ""),
        fromEmail: String(data.from_email || "").replace(/'/g, ""),
        toEmails: String(data.to_emails || "").replace(/'/g, ""),
      });
    }

    // POST - Save (upsert single row)
    if (req.method === "POST") {
      const obj = await req.json();

      const record = {
        api_key: cleanStr(obj.apiKey || ""),
        from_email: cleanStr(obj.fromEmail || ""),
        to_emails: cleanStr(obj.toEmails || ""),
      };

      const { data: existing } = await supabase
        .from("setting_email").select("id").order("id");

      if (existing && existing.length > 0) {
        await supabase.from("setting_email").update(record).eq("id", existing[0].id);
      } else {
        await supabase.from("setting_email").insert(record);
      }

      return successResponse(true);
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
```

- [ ] **Step 2: Verifikasi (butuh Docker + env)**

Buat file `.env` di root (sudah di-gitignore):
```
SB_URL=https://<project-ref>.supabase.co
SB_SERVICE_ROLE_KEY=<service-role-key>
```

Run: `supabase functions serve setting-email --env-file .env`
Expected: fungsi jalan di `http://127.0.0.1:54321/functions/v1/setting-email`. Jika Docker tidak tersedia, lanjut ke Step 4 dengan review kode.

- [ ] **Step 3: Uji GET & POST via curl (jika serve jalan)**

```bash
curl.exe -s http://127.0.0.1:54321/functions/v1/setting-email
curl.exe -s -X POST http://127.0.0.1:54321/functions/v1/setting-email -H "Content-Type: application/json" -d '{"apiKey":"re_test","fromEmail":"a@b.com","toEmails":"x@y.com"}'
curl.exe -s http://127.0.0.1:54321/functions/v1/setting-email
```
Expected: POST → `{"success":true,"data":true}`; GET kedua → `{"success":true,"data":{"apiKey":"re_test","fromEmail":"a@b.com","toEmails":"x@y.com"}}`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/setting-email/index.ts
git commit -m "feat: edge function setting-email (CRUD tujuan email laporan)"
```

---

### Task 3: Edge Function `kirim-laporan-harian`

**Files:**
- Create: `supabase/functions/kirim-laporan-harian/index.ts`

**Interfaces:**
- Consumes: `setting_email` tabel (Task 1); helper `_shared/cors.ts`, `_shared/supabase.ts`, `_shared/utils.ts` (`cleanStr`, `formatTglIndo`); endpoint internal yang sudah ada:
  - `GET /posisi-kas?action=rekap-harian-global&tanggal=<tgl>&kodeWilayah=<kw>` → `{ saldoKemarin, penerimaanDebet, penerimaanAntar, pembayaranKredit, pembayaranAntar, saldoHariIni, saldoFisik, selisih, userTerdata, totalBonTambahan, totalSetorTambahan }`
  - `GET /laporan-ht?action=saldo-kas&tanggal=<tgl>&kodeWilayah=<kw>` → `{ htRincian: [{kategori, pecahan, lembar, nominal, order}], totalHT, tellerList: [{userEstim, namaUnit, total}], totalTeller, grandTotal }`
  - `GET /laporan-ht?action=mutasi&tanggal=<tgl>&kodeWilayah=<kw>&tipeLap=SETOR|BON` → `{ rincian: [{kategori, pecahan, lembar, nominal, order}], total, tellerList, totalTeller }`
  - `GET /cluis?tanggal=<tgl>&kodeWilayah=<kw>` → `{ rincian: [{kategori, pecahan, lembarSebelumnya, nominalSebelumnya, lembarPengeluaran, nominalPengeluaran, lembarCluis, nominalCluis, order}], totalHariSebelumnya, totalPengeluaran, totalCluis }`
- Produces: endpoint `POST /kirim-laporan-harian` body `{ tanggal, kodeWilayah, userEstim, role, preview? }`. Sukses → `{ emailId, to, tanggal, totalHT, grandTotal }`; preview → `{ previewPdfBase64, filename }`. Dipakai frontend Task 5.

- [ ] **Step 1: Buat file edge function**

```ts
// Edge Function: /api/kirim-laporan-harian
// Generate Laporan Akhir Hari (PDF) dan kirim via email (Resend)
// Body: { tanggal, kodeWilayah, userEstim, role, preview? }

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatTglIndo } from "../_shared/utils.ts";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const RESEND_URL = "https://api.resend.com/emails";

function formatRp(n: number): string {
  return "Rp " + (n || 0).toLocaleString("id-ID");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[]);
  }
  return btoa(binary);
}

async function internalFetch(path: string): Promise<any> {
  const resp = await fetch(`${Deno.env.get("SB_URL")}/functions/v1${path}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` },
  });
  const json = await resp.json();
  if (!json?.success) throw new Error(`[internal] ${path} -> ${json?.error || "failed"}`);
  return json.data;
}

// =============================================
// PDF BUILDER
// =============================================
async function buildReportPdf(rep: {
  tanggal: string;
  kodeWilayah: string;
  userInfo: { namaUser: string; userEstim: string };
  posisi: any;
  saldoKas: any;
  setoran: any;
  pengeluaran: any;
  cluis: any;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 842, PAGE_H = 595, M = 30, LINE = 16;
  const NAVY = rgb(0.11, 0.22, 0.44);
  const RED = rgb(0.72, 0.07, 0.07);
  const BLUE = rgb(0.02, 0.5, 0.72);
  const GREEN = rgb(0.05, 0.55, 0.3);
  const GRAY = rgb(0.55, 0.55, 0.55);
  const DARK = rgb(0.1, 0.1, 0.1);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = M + 6; // cursor dari atas
  let pageNum = 1;

  const drawY = () => PAGE_H - y;
  const footer = () => {
    page.drawText("Laporan Akhir Hari - " + formatTglIndo(rep.tanggal), { x: M, y: M - 14, size: 8, font, color: GRAY });
    page.drawText("Halaman " + pageNum, { x: PAGE_W - M - 60, y: M - 14, size: 8, font, color: GRAY });
  };
  footer();

  const ensure = (h: number) => {
    if (y + h > PAGE_H - M) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = M + 6;
      pageNum++;
      footer();
    }
  };

  const sectionTitle = (text: string, color: any = NAVY) => {
    ensure(LINE * 2 + 6);
    y += 10;
    page.drawText(text, { x: M, y: drawY() - 12, size: 13, font: bold, color });
    y += LINE;
    page.drawLine({ start: [M, drawY() + 4], end: [PAGE_W - M, drawY() + 4], thickness: 1, color: GRAY });
    y += 4;
  };

  const labelValue = (label: string, value: string, emphasis = false) => {
    ensure(LINE);
    page.drawText(label, { x: M, y: drawY() - 11, size: 10, font: emphasis ? bold : font, color: DARK });
    page.drawText(value, { x: PAGE_W - M - 220, y: drawY() - 11, size: 10, font: emphasis ? bold : font, color: DARK });
    y += LINE;
  };

  const table = (
    headers: string[],
    widths: number[],
    rows: string[][],
    totalLabel?: string,
    totalValue?: string,
  ) => {
    const rowH = 15;
    const totalW = widths.reduce((a, b) => a + b, 0);
    ensure(rowH * 2);
    page.drawRectangle({ x: M, y: drawY() - 13, width: totalW, height: 13, color: rgb(0.9, 0.93, 0.97) });
    let hx = M;
    for (let i = 0; i < headers.length; i++) {
      page.drawText(headers[i], { x: hx + 3, y: drawY() - 12, size: 8.5, font: bold });
      hx += widths[i];
    }
    y += rowH;
    for (const row of rows) {
      ensure(rowH);
      let rx = M;
      for (let i = 0; i < row.length; i++) {
        page.drawText(row[i], { x: rx + 3, y: drawY() - 11, size: 8.5, font });
        rx += widths[i];
      }
      page.drawLine({ start: [M, drawY() - 2], end: [M + totalW, drawY() - 2], thickness: 0.3, color: rgb(0.85, 0.87, 0.9) });
      y += rowH;
    }
    if (totalLabel) {
      ensure(rowH);
      page.drawRectangle({ x: M, y: drawY() - 13, width: totalW, height: 13, color: rgb(0.96, 0.96, 0.92) });
      page.drawText(totalLabel, { x: M + 3, y: drawY() - 12, size: 9, font: bold });
      page.drawText(totalValue || "", { x: M + totalW - 150, y: drawY() - 12, size: 9, font: bold });
      y += rowH;
    }
  };

  const rincianRows = (rincian: any[]): string[][] => {
    const rows: string[][] = [];
    let currentCat = "";
    let sub = 0, subLembar = 0;
    for (const r of rincian) {
      if (currentCat !== "" && currentCat !== r.kategori) {
        rows.push([`Subtotal ${currentCat}`, "", String(subLembar), formatRp(sub)]);
        sub = 0; subLembar = 0;
      }
      currentCat = r.kategori;
      sub += Number(r.nominal) || 0;
      subLembar += Number(r.lembar) || 0;
      const pec = isNaN(Number(r.pecahan)) ? String(r.pecahan) : Number(r.pecahan).toLocaleString("id-ID");
      rows.push([String(r.kategori), pec, String(r.lembar), formatRp(Number(r.nominal))]);
    }
    if (currentCat) rows.push([`Subtotal ${currentCat}`, "", String(subLembar), formatRp(sub)]);
    return rows;
  };

  const tellerToRows = (tellerList: any[], emptyText: string): string[][] => {
    const rows = (tellerList || []).map((t: any) => [
      String(t.namaUnit || "-"),
      String(t.userEstim || "-"),
      formatRp(Number(t.total)),
    ]);
    if (rows.length === 0) rows.push([emptyText, "", ""]);
    return rows;
  };

  // HEADER DOKUMEN
  y += 6;
  page.drawText("LAPORAN AKHIR HARI", { x: M, y: drawY() - 16, size: 18, font: bold, color: NAVY });
  y += 24;
  page.drawText("Tanggal: " + formatTglIndo(rep.tanggal), { x: M, y: drawY() - 10, size: 10, font });
  page.drawText("Wilayah: " + rep.kodeWilayah, { x: M + 240, y: drawY() - 10, size: 10, font });
  page.drawText("User: " + (rep.userInfo.namaUser || rep.userInfo.userEstim), { x: M + 480, y: drawY() - 10, size: 10, font });
  y += LINE * 2;
  page.drawLine({ start: [M, drawY() + 2], end: [PAGE_W - M, drawY() + 2], thickness: 2, color: NAVY });
  y += 8;

  // A. POSISI HARIAN KAS
  sectionTitle("A. POSISI HARIAN KAS");
  const p = rep.posisi || {};
  labelValue("SALDO KEMARIN HARI", formatRp(p.saldoKemarin));
  labelValue("PENERIMAAN KAS HARI INI (DEBET)", formatRp(p.penerimaanDebet));
  labelValue("PENERIMAAN KAS ANTAR TELLER", formatRp(p.penerimaanAntar));
  labelValue("PEMBAYARAN KAS HARI INI (KREDIT)", formatRp(p.pembayaranKredit));
  labelValue("PEMBAYARAN KAS ANTAR TELLER", formatRp(p.pembayaranAntar));
  labelValue("SALDO HARI INI (SISTEM)", formatRp(p.saldoHariIni), true);
  labelValue("SALDO KAS MENURUT FISIK UANG", formatRp(p.saldoFisik), true);
  labelValue("SELISIH KAS LEBIH / KURANG", formatRp(p.selisih), true);
  labelValue("JUMLAH USER TERDATA", String(p.userTerdata || 0));

  // B. RINCIAN SALDO KHASANAH
  sectionTitle("B. RINCIAN SALDO KHASANAH", RED);
  table(
    ["Kategori", "Pecahan", "Lembar/Keping", "Nominal Total"],
    [180, 120, 130, 220],
    rincianRows(rep.saldoKas?.htRincian || []),
    "TOTAL SALDO KHASANAH",
    formatRp(rep.saldoKas?.totalHT),
  );
  sectionTitle("B.2 SALDO FISIK CASHBOX TELLER (SETOR SORE)", BLUE);
  table(
    ["Nama Unit Kerja / Cabang", "User Estim", "Total Saldo (Setor Sore)"],
    [330, 140, 180],
    tellerToRows(rep.saldoKas?.tellerList, "Belum ada Teller setor sore"),
    "TOTAL CASHBOX TELLER",
    formatRp(rep.saldoKas?.totalTeller),
  );
  labelValue("GRAND TOTAL SALDO (KHASANAH + TELLER)", formatRp(rep.saldoKas?.grandTotal), true);

  // C. SETORAN KHASANAH
  sectionTitle("C. SETORAN KHASANAH", GREEN);
  table(
    ["Kategori", "Pecahan", "Lembar/Keping", "Nominal Total"],
    [180, 120, 130, 220],
    rincianRows(rep.setoran?.rincian || []),
    "TOTAL SETORAN",
    formatRp(rep.setoran?.total),
  );
  sectionTitle("C.1 RINCIAN PER TELLER", BLUE);
  table(
    ["Nama Unit Kerja / Cabang", "User Estim", "Nominal Mutasi"],
    [330, 140, 180],
    tellerToRows(rep.setoran?.tellerList, "Belum ada teller"),
    "TOTAL TELLER",
    formatRp(rep.setoran?.totalTeller),
  );

  // D. PENGELUARAN KHASANAH
  sectionTitle("D. PENGELUARAN KHASANAH", RED);
  table(
    ["Kategori", "Pecahan", "Lembar/Keping", "Nominal Total"],
    [180, 120, 130, 220],
    rincianRows(rep.pengeluaran?.rincian || []),
    "TOTAL PENGELUARAN",
    formatRp(rep.pengeluaran?.total),
  );
  sectionTitle("D.1 RINCIAN PER TELLER", BLUE);
  table(
    ["Nama Unit Kerja / Cabang", "User Estim", "Nominal Mutasi"],
    [330, 140, 180],
    tellerToRows(rep.pengeluaran?.tellerList, "Belum ada teller"),
    "TOTAL TELLER",
    formatRp(rep.pengeluaran?.totalTeller),
  );

  // E. SISA DALAM KHASANAH (CLUIS)
  sectionTitle("E. SISA DALAM KHASANAH (CLUIS)", GREEN);
  const cluisRows = (rep.cluis?.rincian || []).map((r: any) => {
    const pec = isNaN(Number(r.pecahan)) ? String(r.pecahan) : Number(r.pecahan).toLocaleString("id-ID");
    return [
      String(r.kategori), pec,
      String(r.lembarSebelumnya), formatRp(Number(r.nominalSebelumnya)),
      String(r.lembarPengeluaran), formatRp(Number(r.nominalPengeluaran)),
      String(r.lembarCluis), formatRp(Number(r.nominalCluis)),
    ];
  });
  if (cluisRows.length === 0) cluisRows.push(["Tidak ada riwayat saldo khasanah di tanggal ini", "", "", "", "", "", "", ""]);
  table(
    ["Kategori", "Pecahan", "Lbr Kemarin", "Nominal Kemarin", "Lbr Pengeluaran", "Nominal Pengeluaran", "Lbr Cluis", "Nominal Cluis"],
    [120, 85, 75, 110, 85, 110, 55, 110],
    cluisRows,
    "TOTAL GLOBAL",
    formatRp(rep.cluis?.totalCluis),
  );

  return await doc.save();
}

// =============================================
// MAIN HANDLER
// =============================================
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

    // 3. Fetch 5 dataset
    const [posisi, saldoKas, setoran, pengeluaran, cluis] = await Promise.all([
      internalFetch(`/posisi-kas?action=rekap-harian-global&tanggal=${tanggal}&kodeWilayah=${kodeWilayah}`),
      internalFetch(`/laporan-ht?action=saldo-kas&tanggal=${tanggal}&kodeWilayah=${kodeWilayah}`),
      internalFetch(`/laporan-ht?action=mutasi&tanggal=${tanggal}&kodeWilayah=${kodeWilayah}&tipeLap=SETOR`),
      internalFetch(`/laporan-ht?action=mutasi&tanggal=${tanggal}&kodeWilayah=${kodeWilayah}&tipeLap=BON`),
      internalFetch(`/cluis?tanggal=${tanggal}&kodeWilayah=${kodeWilayah}`),
    ]);

    // 4. Cek data kosong
    const userTerdata = Number(posisi?.userTerdata || 0);
    const grandTotal = Number(saldoKas?.grandTotal || 0);
    if (userTerdata === 0 && grandTotal === 0) {
      return errorResponse(`Belum ada data laporan untuk tanggal ${tanggal}`);
    }

    // 5. Build PDF
    const pdfBytes = await buildReportPdf({
      tanggal,
      kodeWilayah,
      userInfo: { namaUser: String(user.nama_user || ""), userEstim },
      posisi,
      saldoKas,
      setoran,
      pengeluaran,
      cluis,
    });

    if (preview) {
      return successResponse({
        previewPdfBase64: bytesToBase64(pdfBytes),
        filename: `Laporan_Akhir_Hari_${tanggal}.pdf`,
      });
    }

    // 6. Kirim email via Resend
    const subject = `Laporan Akhir Hari - ${formatTglIndo(tanggal)}`;
    const html = `<html><body style="font-family:Arial,sans-serif">
      <h2>Laporan Akhir Hari</h2>
      <p>Tanggal: <b>${formatTglIndo(tanggal)}</b></p>
      <p>Wilayah: ${kodeWilayah}</p>
      <p>Dikirim oleh: ${user.nama_user || userEstim}</p>
      <p>Total Saldo Khasanah: <b>${formatRp(saldoKas?.totalHT)}</b></p>
      <p>Grand Total (Khasanah + Cashbox Teller): <b>${formatRp(grandTotal)}</b></p>
      <p>PDF laporan terlampir.</p>
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
        attachments: [{
          filename: `Laporan_Akhir_Hari_${tanggal}.pdf`,
          content: bytesToBase64(pdfBytes),
        }],
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
      totalHT: Number(saldoKas?.totalHT || 0),
      grandTotal,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[kirim-laporan-harian] Exception:", msg);
    return errorResponse("ERROR: " + msg, 500);
  }
});
```

- [ ] **Step 2: Verifikasi sintaks/tipe**

Deno lokal tidak terpasang di lingkungan ini. Verifikasi manual dengan membaca kembali file: pastikan semua fungsi helper (`formatRp`, `bytesToBase64`, `internalFetch`, `buildReportPdf`) terdefinisi sebelum dipakai, dan import `npm:pdf-lib@1.17.1` ada di baris 10.

- [ ] **Step 3: Uji preview mode via curl (jika Docker tersedia)**

```bash
supabase functions serve kirim-laporan-harian --env-file .env
curl.exe -s -X POST http://127.0.0.1:54321/functions/v1/kirim-laporan-harian -H "Content-Type: application/json" -d "{\"tanggal\":\"2026-08-04\",\"kodeWilayah\":\"ALL\",\"userEstim\":\"<estim_teller>\",\"role\":\"teller\",\"preview\":true}"
```
Expected: `{"success":true,"data":{"previewPdfBase64":"JVBERi0..."}}`. Decode base64 untuk memastikan PDF valid (dimulai `%PDF`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/kirim-laporan-harian/index.ts
git commit -m "feat: edge function kirim-laporan-harian (generate PDF + kirim email Resend)"
```

---

### Task 4: Frontend — halaman admin "Tujuan Email Laporan"

**Files:**
- Modify: `frontend/index.html`
  - Baris ~238 (menu admin, setelah item "⚙️ Notifikasi WA")
  - Baris ~493 (setelah penutup `div` halaman `#setting-wa-gateway`)
  - `_GAS_MAP` (sekitar baris 1262-1331)
  - Daerah fungsi JS (dekat `loadWAGatewaySettings` baris ~3654)

**Interfaces:**
- Consumes: `GET /setting-email`, `POST /setting-email` (Task 2)
- Produces: menu admin + halaman `#setting-email` + fungsi `loadSettingEmail()`, `simpanSettingEmail()` (dipakai konsisten dengan Task 5 yang memakai `_GAS_MAP` yang sama)

- [ ] **Step 1: Tambah item menu admin**

Setelah baris menu "⚙️ Notifikasi WA" tambahkan item baru di dalam `div.role-menu.menu-admin`:

```html
      <div class="menu-item" onclick="nav('setting-email', this); loadSettingEmail();">✉️ Tujuan Email Laporan</div>
```

- [ ] **Step 2: Tambah halaman `#setting-email`**

Tepat setelah penutup `</div>` halaman `#setting-wa-gateway` (baris 492) tambahkan halaman baru:

```html
      <div id="setting-email" class="page role-page-admin">
        <div class="header-page"><h3>Pengaturan Tujuan Email Laporan Akhir Hari</h3></div>
        <p style="margin:0 0 15px 0; color:var(--text-muted);">Konfigurasi pengiriman Laporan Akhir Hari (PDF) yang ditrigger oleh role Teller. Alamat pengirim (From) harus email yang sudah diverifikasi di akun Resend.</p>
        <div class="form-row">
          <div class="form-group"><label>Resend API Key</label><input type="password" id="se-apikey" placeholder="re_xxxxxx" style="background:var(--input-yellow);"></div>
          <div class="form-group"><label>From Email (Pengirim)</label><input type="email" id="se-from" placeholder="laporan@domain.com" style="background:var(--input-yellow);"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tujuan Email (lebih dari satu dipisah koma)</label><input type="text" id="se-to" placeholder="email1@domain.com, email2@domain.com" style="background:var(--input-yellow);"></div>
        </div>
        <div style="display:flex; gap:15px; flex-wrap:wrap; margin-top:25px;">
          <button class="btn-refresh" style="flex:2; font-size:1.1rem; padding:15px; margin:0;" onclick="simpanSettingEmail()">💾 SIMPAN PENGATURAN</button>
        </div>
      </div>
```

- [ ] **Step 3: Daftarkan GAS function**

Di dalam objek `_GAS_MAP`, tambahkan (letakkan setelah entri `saveSettingWAGateway`):

```js
      getSettingEmail:            ['GET','/setting-email'],
      saveSettingEmail:           ['POST','/setting-email'],
```

- [ ] **Step 4: Tambah fungsi JS `loadSettingEmail` dan `simpanSettingEmail`**

Tambahkan di dekat fungsi `loadWAGatewaySettings`:

```js
    function loadSettingEmail() {
      showLoader(true);
      google.script.run.withSuccessHandler((res) => {
        showLoader(false);
        document.getElementById('se-apikey').value = (res && res.apiKey) || '';
        document.getElementById('se-from').value = (res && res.fromEmail) || '';
        document.getElementById('se-to').value = (res && res.toEmails) || '';
      }).withFailureHandler((err) => { showLoader(false); alert("Gagal memuat setting email: " + err.message); }).getSettingEmail();
    }
    function simpanSettingEmail() {
      const apiKey = document.getElementById('se-apikey').value.trim();
      const fromEmail = document.getElementById('se-from').value.trim();
      const toEmails = document.getElementById('se-to').value.trim();
      if (!fromEmail || !toEmails) { alert("From Email dan Tujuan Email wajib diisi!"); return; }
      showLoader(true, "Menyimpan setting email...");
      google.script.run.withSuccessHandler(() => { showLoader(false); showToast(false); }).withFailureHandler((err) => { showLoader(false); alert("Gagal menyimpan: " + err.message); }).saveSettingEmail({ apiKey: apiKey, fromEmail: fromEmail, toEmails: toEmails });
    }
```

- [ ] **Step 5: Verifikasi**

Review: pastikan `getSettingEmail`, `saveSettingEmail` terdaftar di `_GAS_MAP`, halaman `#setting-email` punya class `page role-page-admin`, dan ID elemen (`se-apikey`, `se-from`, `se-to`) cocok antara HTML dan JS.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html
git commit -m "feat: halaman admin tujuan email laporan akhir hari"
```

---

### Task 5: Frontend — submenu Teller "Generate & Kirim Laporan Akhir Hari"

**Files:**
- Modify: `frontend/index.html`
  - Menu teller (setelah submenu "POSISI KAS TELLER", sekitar baris 293)
  - Halaman baru `#kirim-laporan-harian` (tempatkan dekat halaman laporan lain, mis. sebelum `#lap-posisi-harian` baris 951)
  - `_GAS_MAP`
  - Daerah fungsi JS

**Interfaces:**
- Consumes: `POST /kirim-laporan-harian` (Task 3); `currentUser.kodeWilayah`, `currentUser.userEstim`, `currentUser.role` (di-set saat login); `getLocalDateString()` (sudah ada)
- Produces: menu teller + halaman `#kirim-laporan-harian` + fungsi `initKirimLaporanHarian()`, `kirimLaporanHarian()`

- [ ] **Step 1: Tambah item menu teller**

Di dalam `div.role-menu.menu-teller`, tepat setelah penutup `div#sub-posisi-teller` (baris 293), tambahkan:

```html
      <div class="menu-item" onclick="nav('kirim-laporan-harian', this); initKirimLaporanHarian();">✉️ Kirim Laporan Akhir Hari (PDF)</div>
```

- [ ] **Step 2: Tambah halaman `#kirim-laporan-harian`**

Tepat sebelum halaman `#lap-posisi-harian` (baris 951) tambahkan:

```html
      <div id="kirim-laporan-harian" class="page">
        <div class="header-page">
          <div>
            <h3>Generate &amp; Kirim Laporan Akhir Hari (PDF)</h3>
            <p style="margin: 5px 0 0 0;">Sistem mengekspor posisi harian kas, rincian saldo khasanah, setoran khasanah, pengeluaran khasanah, dan sisa dalam khasanah ke PDF, lalu otomatis mengirim email sesuai tujuan yang diatur admin.</p>
          </div>
        </div>
        <div class="form-row" style="align-items: flex-end;">
          <div class="form-group"><label>Tanggal Laporan</label><input type="date" id="klh-tgl" style="background:var(--input-yellow);"></div>
          <div class="form-group"><button class="btn-refresh" style="margin-bottom:0; width:100%; padding:14px;" onclick="kirimLaporanHarian()">📤 GENERATE &amp; KIRIM LAPORAN</button></div>
        </div>
        <div id="klh-result" style="margin-top:20px;"></div>
      </div>
```

- [ ] **Step 3: Daftarkan GAS function**

Di dalam objek `_GAS_MAP`, tambahkan (letakkan setelah entri `saveSettingEmail` dari Task 4):

```js
      kirimLaporanHarian:         ['POST','/kirim-laporan-harian'],
```

- [ ] **Step 4: Tambah fungsi JS `initKirimLaporanHarian` dan `kirimLaporanHarian`**

Tambahkan di dekat fungsi Task 4 (setelah `simpanSettingEmail`):

```js
    function initKirimLaporanHarian() {
      document.getElementById('klh-tgl').value = getLocalDateString();
      document.getElementById('klh-result').innerHTML = '';
    }
    function kirimLaporanHarian() {
      const tgl = document.getElementById('klh-tgl').value;
      if (!tgl) { alert("Pilih tanggal laporan terlebih dahulu!"); return; }
      if (!confirm("Kirim Laporan Akhir Hari untuk tanggal " + tgl + "?\nPDF akan dikirim via email ke tujuan yang diatur admin.")) return;
      showLoader(true, "Mengekspor data & mengirim email...");
      document.getElementById('klh-result').innerHTML = '<p style="color:var(--text-muted);">Memproses laporan...</p>';
      google.script.run.withSuccessHandler((res) => {
        showLoader(false);
        document.getElementById('klh-result').innerHTML =
          `<div class="summary-box" style="background:#ecfdf5; border-left:5px solid #059669; margin-top:10px;">
            <p style="margin:0; font-weight:700; color:#059669;">✅ Laporan berhasil dikirim</p>
            <p style="margin:8px 0 0 0; color:#1e293b;">Tanggal: <b>${res.tanggal || tgl}</b><br>Email tujuan: <b>${res.to || '-'}</b><br>Total Saldo Khasanah: <b>${Number(res.totalHT || 0).toLocaleString('id-ID')}</b><br>Grand Total: <b>${Number(res.grandTotal || 0).toLocaleString('id-ID')}</b></p>
          </div>`;
        showToast(false);
      }).withFailureHandler((err) => {
        showLoader(false);
        document.getElementById('klh-result').innerHTML =
          `<div class="summary-box" style="background:#fef2f2; border-left:5px solid #dc2626; margin-top:10px;">
            <p style="margin:0; font-weight:700; color:#dc2626;">❌ Gagal mengirim laporan</p>
            <p style="margin:8px 0 0 0; color:#1e293b;">${err.message}</p>
          </div>`;
      }).kirimLaporanHarian({ tanggal: tgl, kodeWilayah: currentUser.kodeWilayah, userEstim: currentUser.userEstim, role: currentUser.role });
    }
```

- [ ] **Step 5: Verifikasi**

Review: `kirimLaporanHarian` terdaftar di `_GAS_MAP`; ID elemen (`klh-tgl`, `klh-result`) cocok antara HTML dan JS; pastikan tidak ada duplikasi nama fungsi `kirimLaporanHarian` dengan yang lain (grep `function kirimLaporanHarian` harus muncul tepat 1 kali).

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html
git commit -m "feat: submenu teller generate & kirim laporan akhir hari PDF via email"
```

---

### Task 6: Update README

**Files:**
- Modify: `README.md`
  - Struktur project: tambahkan `setting-email` dan `kirim-laporan-harian` pada daftar functions
  - Tabel API Endpoints: tambahkan 2 baris
  - Tabel Database Tables: tambahkan `setting_email`
  - Bagian deploy: tambahkan deploy command kedua fungsi

**Interfaces:**
- Consumes: nama endpoint/fungsi dari Task 2 dan Task 3

- [ ] **Step 1: Update daftar functions di struktur project**

Setelah baris `│       ├── setting-wa-gateway/ # ...` tambahkan:

```markdown
│       ├── setting-email/  # GET/POST /api/setting-email (✅ Email Laporan Akhir Hari)
│       ├── kirim-laporan-harian/ # POST /api/kirim-laporan-harian (✅ Generate PDF + Kirim Email)
```

- [ ] **Step 2: Update tabel API Endpoints**

Tambahkan di tabel (mis. setelah baris `| GET/POST | /api/setting-wa-gateway | ...` — atau di baris yang sesuai):

```markdown
| GET/POST | `/api/setting-email` | Setting tujuan email laporan (Resend) |
| POST | `/api/kirim-laporan-harian` | Generate PDF Laporan Akhir Hari & kirim email |
```

- [ ] **Step 3: Update tabel Database Tables**

Tambahkan:

```markdown
| `setting_email` | Konfigurasi tujuan email laporan harian |
```

- [ ] **Step 4: Update deploy commands**

Di blok deploy (setelah `supabase functions deploy setting-wa-gateway --no-verify-jwt`), tambahkan:

```bash
supabase functions deploy setting-email --no-verify-jwt
supabase functions deploy kirim-laporan-harian --no-verify-jwt
```

- [ ] **Step 5: Verifikasi**

Run: `git -C D:\Project\KasM diff README.md`
Expected: 4 perubahan sesuai langkah 1-4, tidak mengubah baris lain.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README tambah setting-email & kirim-laporan-harian"
```

---

## Self-Review Checklist

- **Spec coverage:** Migration ✓ (Task 1), setting-email edge ✓ (Task 2), kirim-laporan-harian + PDF 5 bagian + Resend + preview ✓ (Task 3), admin page ✓ (Task 4), teller submenu ✓ (Task 5), README ✓ (Task 6). Semua bagian spec tercakup.
- **Placeholder scan:** Tidak ada TBD/TODO; setiap langkah berisi kode atau perintah konkret.
- **Type consistency:** Nama fungsi frontend (`loadSettingEmail`, `simpanSettingEmail`, `initKirimLaporanHarian`, `kirimLaporanHarian`), entri `_GAS_MAP`, ID elemen HTML, dan kolom tabel DB konsisten di semua task. Response key edge function (`apiKey/fromEmail/toEmails`, `emailId/to/tanggal/totalHT/grandTotal`, `previewPdfBase64/filename`) konsisten antara backend dan frontend.
