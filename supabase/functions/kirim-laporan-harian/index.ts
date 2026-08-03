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
