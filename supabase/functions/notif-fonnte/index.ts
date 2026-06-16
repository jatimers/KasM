// Edge Function: /api/notif-fonnte
// Full implementation ported from Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit, formatSafeString, formatTglIndo } from "../_shared/utils.ts";

const supabase = getSupabaseAdmin();

async function fonnteSend(token: string, target: string, message: string): Promise<string> {
  const resp = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { "Authorization": token, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ target, message }).toString(),
  });
  return resp.text();
}

// Helper: get libur map
async function getLiburMap(): Promise<Record<string, boolean>> {
  const { data } = await supabase.from("hari_libur").select("tanggal");
  const map: Record<string, boolean> = {};
  for (const row of (data || [])) {
    const tgl = formatSafeString(row.tanggal);
    if (tgl && tgl !== "-") map[tgl] = true;
  }
  return map;
}

function isWorkingDay(dateStr: string, liburMap: Record<string, boolean>): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const dayOfWeek = d.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6 || liburMap[dateStr]) return false;
  return true;
}

// Fetch setting fonnte
async function getSetting() {
  const { data } = await supabase.from("setting_fonnte").select("*").order("id").limit(1).maybeSingle();
  return data;
}

// =============================================
// LAPORAN HT (dailyFonnteTask replacement)
// =============================================
async function sendLaporanHT(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const token = setting?.token;
  const target = cleanStr(setting?.no_hp || "");
  if (!token || !target) return "Token/NoHP belum diatur";

  // Query laporan-ht to get grand total
  const laporUrl = `${Deno.env.get("SB_URL")}/functions/v1/laporan-ht?action=saldo-kas&tanggal=${tgl}&kodeWilayah=${kodeWilayah}`;
  const laporResp = await fetch(laporUrl, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` }
  });
  const laporJson = await laporResp.json();
  const rekap = laporJson?.data || {};

  // Hitung pecahan ULE
  let p100k = 0, p50k = 0;
  for (const r of (rekap.htRincian || [])) {
    if (r.kategori === "ULE") {
      if (parseInt(String(r.pecahan)) === 100000) p100k = r.lembar;
      if (parseInt(String(r.pecahan)) === 50000) p50k = r.lembar;
    }
  }
  const nominal100 = p100k * 100000;
  const nominal50 = p50k * 50000;

  let msg = "*LAPORAN POSISI KHASANAH*\n";
  msg += "Tanggal: " + formatTglIndo(tgl) + "\n";
  msg += "*Pecahan ULE:*\n";
  msg += "Rp 100.000 : " + p100k + " lbr (Rp " + nominal100.toLocaleString("id-ID") + ")\n";
  msg += "Rp 50.000 : " + p50k + " lbr (Rp " + nominal50.toLocaleString("id-ID") + ")\n\n";
  msg += "*Total Saldo Khasanah*: Rp " + (rekap.totalHT || 0).toLocaleString("id-ID") + "\n\n";
  msg += "_from Cash Monitor App_";

  return fonnteSend(token, target.replace(/\s+/g, ""), msg);
}

// =============================================
// NOTIF POSISI KAS (sendNotifPosisiKasWA)
// =============================================
async function sendPosisiKas(dataObj: any, setting: any): Promise<string> {
  const token = setting?.token_kf;
  const target = cleanStr(setting?.target_posisi_kas || "");
  if (!token || !target) return "Token/Target Posisi Kas belum diatur";

  // Find next working day
  const liburMap = await getLiburMap();
  const d = new Date(dataObj.Tanggal + "T00:00:00");
  d.setDate(d.getDate() + 1);
  let tglH1 = "";
  let iter = 0;
  while (iter < 14) {
    d.setDate(d.getDate() + 1);
    iter++;
    const checkStr = d.toISOString().split("T")[0];
    if (d.getDay() === 0 || d.getDay() === 6 || liburMap[checkStr]) continue;
    tglH1 = checkStr;
    break;
  }

  // Get perkiraan for H+1
  let perkiraan: any = {};
  if (tglH1) {
    const { data: perk } = await supabase.from("perkiraan_bon_setor")
      .select("*").eq("tanggal", tglH1).eq("user_estim", dataObj.UserEstim).maybeSingle();
    if (perk) perkiraan = perk;
  }

  const totalBonH1 = Number(perkiraan.p100k_bon || 0) + Number(perkiraan.p50k_bon || 0);
  const totalSetorH1 = Number(perkiraan.p100k_setor || 0) + Number(perkiraan.p50k_setor || 0);

  let msg = "*LAPORAN POSISI KAS KF*\n";
  msg += "Tanggal: " + formatTglIndo(dataObj.Tanggal) + "\n";
  msg += "Unit Kerja: " + (dataObj.NamaUnit || "-") + " / " + dataObj.UserEstim + "\n";
  msg += "--------------------------------\n";
  msg += "Bon Pagi: Rp " + Number(dataObj.BonPagi || 0).toLocaleString("id-ID") + "\n";
  msg += "Penerimaan Kas: Rp " + Number(dataObj.PenerimaanDebet || 0).toLocaleString("id-ID") + "\n";
  msg += "Penerimaan Antar Teller: Rp " + Number(dataObj.PenerimaanAntarTeller || 0).toLocaleString("id-ID") + "\n";
  msg += "Pembayaran Kas: Rp " + Number(dataObj.PembayaranKredit || 0).toLocaleString("id-ID") + "\n";
  msg += "Pembayaran Antar Teller: Rp " + Number(dataObj.PembayaranAntarTeller || 0).toLocaleString("id-ID") + "\n";
  msg += "Setor Sore: Rp " + Number(dataObj.SaldoFisik || 0).toLocaleString("id-ID") + "\n";
  msg += "Selisih Kas: Rp " + Number(dataObj.SelisihPembulatan || 0).toLocaleString("id-ID") + "\n";
  msg += "--------------------------------\n";
  msg += "*Estimasi Kas H+1 (" + formatTglIndo(tglH1) + ")*\n";
  msg += "Bon: Rp " + totalBonH1.toLocaleString("id-ID") + "\n";
  msg += "Setor: Rp " + totalSetorH1.toLocaleString("id-ID") + "\n\n";
  msg += "_from Cash Monitor Apps_";

  return fonnteSend(token, target.replace(/\s+/g, ""), msg);
}

// =============================================
// SUMMARY PERKIRAAN KF
// =============================================
async function sendPerkiraanKF(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const token = setting?.token_kf;
  const target = cleanStr(setting?.target_kf || "");
  if (!token || !target) return "Token KF/Target belum diatur";

  // Get rekap perkiraan
  const perkUrl = `${Deno.env.get("SB_URL")}/functions/v1/perkiraan?action=rekap&tanggal=${tgl}&kodeWilayah=${kodeWilayah}&tglHariIni=${new Date().toISOString().split("T")[0]}`;
  const perkResp = await fetch(perkUrl, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` }
  });
  const perkJson = await perkResp.json();
  const rekap = perkJson?.data || {};
  const list = rekap.list || [];

  let msg = "*REKAP PERKIRAAN BON/SETOR*\n";
  msg += "Tanggal: " + formatTglIndo(tgl) + "\n";
  msg += "--------------------------------\n";
  let totSetor = 0, totBon = 0;
  for (const r of list) {
    const subS = (Number(r.p100k_setor) || 0) + (Number(r.p50k_setor) || 0);
    const subB = (Number(r.p100k_bon) || 0) + (Number(r.p50k_bon) || 0);
    totSetor += subS; totBon += subB;
    msg += "🏛️ *" + (r.namaUnit || "-") + "*\n";
    msg += "Setor: Rp " + subS.toLocaleString("id-ID") + "\n";
    msg += "Bon: Rp " + subB.toLocaleString("id-ID") + "\n\n";
  }
  msg += "--------------------------------\n";
  msg += "*TOTAL ESTIMASI*\n";
  msg += "📈 Total Setoran: Rp " + totSetor.toLocaleString("id-ID") + "\n";
  msg += "📉 Total Bon: Rp " + totBon.toLocaleString("id-ID") + "\n\n";
  msg += "_from Cash Monitor Apps_";

  return fonnteSend(token, target.replace(/\s+/g, ""), msg);
}

// =============================================
// ANALISA TUKAB
// =============================================
async function sendAnalisaTukab(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const token = setting?.token_kf;
  const target = cleanStr(setting?.target_tukab || "");
  if (!token || !target) return "Token KF/Target TUKAB belum diatur";

  const perkUrl = `${Deno.env.get("SB_URL")}/functions/v1/perkiraan?action=rekap&tanggal=${tgl}&kodeWilayah=${kodeWilayah}&tglHariIni=${new Date().toISOString().split("T")[0]}`;
  const perkResp = await fetch(perkUrl, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` }
  });
  const perkJson = await perkResp.json();
  const rekap = perkJson?.data || {};
  const list = rekap.list || [];

  let tBon100 = 0, tBon50 = 0, tSetor100 = 0, tSetor50 = 0;
  for (const r of list) {
    tBon100 += Number(r.p100k_bon) || 0;
    tBon50 += Number(r.p50k_bon) || 0;
    tSetor100 += Number(r.p100k_setor) || 0;
    tSetor50 += Number(r.p50k_setor) || 0;
  }

  const khasanah100 = Number(rekap.khasanah100) || 0;
  const khasanah50 = Number(rekap.khasanah50) || 0;
  const tersedia100 = khasanah100 + tSetor100;
  const tersedia50 = khasanah50 + tSetor50;
  const hasil100 = Math.max(0, tBon100 - tersedia100);
  const hasil50 = Math.max(0, tBon50 - tersedia50);
  const grandTukab = hasil100 + hasil50;
  const totBon = tBon100 + tBon50;
  const totTersedia = tersedia100 + tersedia50;

  let msg = "*ANALISA KEBUTUHAN TUKAB*\n";
  msg += "Tanggal: " + formatTglIndo(tgl) + "\n";
  msg += "--------------------------------\n";
  msg += "Keb. Bon 100k : Rp " + tBon100.toLocaleString("id-ID") + "\n";
  msg += "Tersedia 100k : Rp " + tersedia100.toLocaleString("id-ID") + "\n";
  msg += "Kekurangan 100k : Rp " + hasil100.toLocaleString("id-ID") + "\n\n";
  msg += "Keb. Bon 50k : Rp " + tBon50.toLocaleString("id-ID") + "\n";
  msg += "Tersedia 50k : Rp " + tersedia50.toLocaleString("id-ID") + "\n";
  msg += "Kekurangan 50k : Rp " + hasil50.toLocaleString("id-ID") + "\n";
  msg += "--------------------------------\n";
  msg += "TOTAL KEKURANGAN: Rp " + grandTukab.toLocaleString("id-ID") + "\n\n";

  let status = "";
  if (grandTukab > 0) {
    if (totTersedia >= totBon) {
      status = "⚠️ *PERHATIAN:*\nDari jumlah nominal keseluruhan, kebutuhan kas tercukupi, namun jika dipilah berdasarkan pecahan:\n";
      if (hasil100 > 0) status += "- Kekurangan pecahan 100.000 sebesar Rp " + hasil100.toLocaleString("id-ID") + "\n";
      if (hasil50 > 0) status += "- Kekurangan pecahan 50.000 sebesar Rp " + hasil50.toLocaleString("id-ID") + "\n";
    } else {
      status = "🚨 *PERLU TUKAB:*\nSaldo Khasanah tidak mencukupi, butuh tambahan fisik Rp " + grandTukab.toLocaleString("id-ID");
    }
  } else {
    status = "✅ *AMAN:*\nSaldo Khasanah & Estimasi Setoran mencukupi kebutuhan.";
  }
  msg += status + "\n\n_from Cash Monitor Apps_";

  return fonnteSend(token, target.replace(/\s+/g, ""), msg);
}

// =============================================
// SUMMARY PERKIRAAN H-1 (dailyPerkiraanH1Task)
// =============================================
async function sendPerkiraanH1(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const token = setting?.token_kf;
  const target = cleanStr(setting?.target_perkiraan_h1 || "");
  if (!token || !target) return "Token/Target H-1 belum diatur";

  const todayISO = new Date().toISOString().split("T")[0];
  const perkUrl = `${Deno.env.get("SB_URL")}/functions/v1/perkiraan?action=rekap&tanggal=${tgl}&kodeWilayah=${kodeWilayah}&tglHariIni=${todayISO}`;
  const perkResp = await fetch(perkUrl, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` }
  });
  const perkJson = await perkResp.json();
  const rekap = perkJson?.data || {};
  const list = rekap.list || [];

  let msg = "*SUMMARY KEBUTUHAN BON HARI INI*\n";
  msg += "Data Tanggal: " + formatTglIndo(tgl) + "\n";
  msg += "--------------------------------\n";
  let totBon100 = 0, totBon50 = 0, unitTersisa = 0;

  for (const r of list) {
    const b100 = Number(r.p100k_bon) || 0;
    const b50 = Number(r.p50k_bon) || 0;
    if (b100 > 0 || b50 > 0) {
      totBon100 += b100; totBon50 += b50; unitTersisa++;
      msg += "🏛️ *" + (r.namaUnit || "-") + "*\n";
      msg += "  • Pec. 100.000: Rp " + b100.toLocaleString("id-ID") + "\n";
      msg += "  • Pec. 50.000 : Rp " + b50.toLocaleString("id-ID") + "\n\n";
    }
  }
  msg += "--------------------------------\n";
  if (unitTersisa === 0) {
    msg += "✅ *Seluruh kebutuhan Bon Teller hari ini sudah diambil / Tidak ada request.*\n\n";
  } else {
    msg += "*TOTAL KEBUTUHAN BON*\n";
    msg += "💰 *Pec. 100.000*: Rp " + totBon100.toLocaleString("id-ID") + "\n";
    msg += "💰 *Pec. 50.000* : Rp " + totBon50.toLocaleString("id-ID") + "\n\n";
  }
  msg += "_from Cash Monitor Apps_";

  return fonnteSend(token, target.replace(/\s+/g, ""), msg);
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
    const action: string = body.action || "laporan-ht";
    const setting = await getSetting();
    if (!setting) return errorResponse("Setting Fonnte belum diatur");

    const kodeWilayah = body.kodeWilayah || "ALL";
    const tgl = body.tanggal || new Date().toISOString().split("T")[0];

    let result = "";

    switch (action) {
      case "laporan-ht":
        result = await sendLaporanHT(tgl, kodeWilayah, setting);
        break;

      case "posisi-kas":
        result = await sendPosisiKas(body.data, setting);
        break;

      case "perkiraan-kf":
        result = await sendPerkiraanKF(tgl, kodeWilayah, setting);
        break;

      case "analisa-tukab":
        result = await sendAnalisaTukab(tgl, kodeWilayah, setting);
        break;

      case "perkiraan-h1":
        result = await sendPerkiraanH1(tgl, kodeWilayah, setting);
        break;

      // === SCHEDULED TASKS (called by pg_cron) ===
      case "scheduled-laporan-ht": {
        const liburMap = await getLiburMap();
        const today = new Date().toISOString().split("T")[0];
        if (!isWorkingDay(today, liburMap)) {
          return successResponse("Hari libur/weekend, skip");
        }
        result = await sendLaporanHT(today, "ALL", setting);
        break;
      }

      case "scheduled-perkiraan-h1": {
        const liburMap = await getLiburMap();
        const today = new Date().toISOString().split("T")[0];
        if (!isWorkingDay(today, liburMap)) {
          return successResponse("Hari libur/weekend, skip");
        }
        result = await sendPerkiraanH1(today, "ALL", setting);
        break;
      }

      default:
        return errorResponse("Invalid action: " + action);
    }

    return successResponse(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
