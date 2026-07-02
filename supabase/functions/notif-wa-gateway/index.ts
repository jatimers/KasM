// Edge Function: /api/notif-wa-gateway
// Migrated from notif-fonnte — Fonnte → WhatsApp Gateway (wa.matradata.com)
// Date: 2026-06-28

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit, formatSafeString, formatTglIndo, getWIBDateString } from "../_shared/utils.ts";

const WA_GATEWAY_URL = "https://wa.matradata.com/api/v1/send-message";
const supabase = getSupabaseAdmin();

async function waGatewaySend(apiKey: string, target: string, message: string): Promise<string> {
  // Bersihkan spasi
  let cleanTarget = target.replace(/\s+/g, "");

  // Jika bukan group (@g.us), tambahkan suffix @c.us untuk personal chat
  // WA Gateway perlu suffix agar routing ke nomor personal berfungsi
  if (!cleanTarget.includes("@")) {
    cleanTarget = cleanTarget + "@c.us";
  }

  const resp = await fetch(WA_GATEWAY_URL, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: cleanTarget, text: message }),
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

// Fetch setting WA Gateway
async function getSetting() {
  const { data } = await supabase.from("setting_wa_gateway").select("*").order("id").limit(1).maybeSingle();
  return data;
}

// =============================================
// LAPORAN HT
// =============================================
async function sendLaporanHT(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const apiKey = setting?.api_key;
  const target = cleanStr(setting?.no_hp || "");
  if (!apiKey || !target) {
    console.error("[sendLaporanHT] GAGAL: API Key/NoHP belum diatur");
    return "ERROR: API Key/NoHP belum diatur";
  }

  const laporUrl = `${Deno.env.get("SB_URL")}/functions/v1/laporan-ht?action=saldo-kas&tanggal=${tgl}&kodeWilayah=${kodeWilayah}`;
  const laporResp = await fetch(laporUrl, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` }
  });
  const laporJson = await laporResp.json();
  const rekap = laporJson?.data || {};

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

  return waGatewaySend(apiKey, target, msg);
}

// =============================================
// NOTIF POSISI KAS
// =============================================
async function sendPosisiKas(dataObj: any, setting: any): Promise<string> {
  const apiKey = setting?.api_key;
  const target = cleanStr(setting?.target_posisi_kas || "");
  if (!apiKey || !target) {
    console.error("[sendPosisiKas] GAGAL: API Key/Target Posisi Kas belum diatur");
    return "ERROR: API Key/Target Posisi Kas belum diatur";
  }

  const liburMap = await getLiburMap();
  const d = new Date(dataObj.Tanggal + "T00:00:00");
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

  let perkiraan: any = {};
  if (tglH1) {
    const { data: perk } = await supabase.from("perkiraan_bon_setor")
      .select("*").eq("tanggal", tglH1).eq("user_estim", dataObj.UserEstim).maybeSingle();
    if (perk) perkiraan = perk;
  }

  const totalBonH1 = Number(perkiraan.p100k_bon || 0) + Number(perkiraan.p50k_bon || 0);
  const totalSetorH1 = Number(perkiraan.p100k_setor || 0) + Number(perkiraan.p50k_setor || 0);

  const setorHT = Number(dataObj.SaldoHariIni || 0);
  const setorSore = Number(dataObj.SaldoFisik || 0);
  const selisih = setorSore - setorHT;

  let msg = "*LAPORAN POSISI KAS KF*\n";
  msg += "Tanggal: " + formatTglIndo(dataObj.Tanggal) + "\n";
  msg += "Unit Kerja: " + (dataObj.NamaUnit || "-") + " / " + dataObj.UserEstim + "\n";
  msg += "--------------------------------\n";
  msg += "Bon Pagi: Rp " + Number(dataObj.BonPagi || 0).toLocaleString("id-ID") + "\n";
  msg += "Penerimaan Kas: Rp " + Number(dataObj.PenerimaanDebet || 0).toLocaleString("id-ID") + "\n";
  msg += "Penerimaan Antar Teller: Rp " + Number(dataObj.PenerimaanAntarTeller || 0).toLocaleString("id-ID") + "\n";
  msg += "Pembayaran Kas: Rp " + Number(dataObj.PembayaranKredit || 0).toLocaleString("id-ID") + "\n";
  msg += "Pembayaran Antar Teller: Rp " + Number(dataObj.PembayaranAntarTeller || 0).toLocaleString("id-ID") + "\n";
  msg += "Setor HT: Rp " + setorHT.toLocaleString("id-ID") + "\n";
  msg += "Setor Sore: Rp " + setorSore.toLocaleString("id-ID") + "\n";
  msg += "Selisih Kas: Rp " + selisih.toLocaleString("id-ID") + "\n";
  msg += "--------------------------------\n";
  msg += "*Estimasi Kas H+1 (" + formatTglIndo(tglH1) + ")*\n";
  msg += "Bon: Rp " + totalBonH1.toLocaleString("id-ID") + "\n";
  msg += "Setor: Rp " + totalSetorH1.toLocaleString("id-ID") + "\n\n";
  msg += "_from Cash Monitor Apps_";

  return waGatewaySend(apiKey, target, msg);
}

// =============================================
// SUMMARY PERKIRAAN KF
// =============================================
async function sendPerkiraanKF(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const apiKey = setting?.api_key;
  const target = cleanStr(setting?.target_kf || "");
  if (!apiKey || !target) {
    console.error("[sendPerkiraanKF] GAGAL: API Key/Target KF belum diatur");
    return "ERROR: API Key/Target KF belum diatur";
  }

  const perkUrl = `${Deno.env.get("SB_URL")}/functions/v1/perkiraan?action=rekap&tanggal=${tgl}&kodeWilayah=${kodeWilayah}&tglHariIni=${getWIBDateString()}`;
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

  return waGatewaySend(apiKey, target, msg);
}

// =============================================
// ANALISA TUKAB
// =============================================
async function sendAnalisaTukab(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const apiKey = setting?.api_key;
  const target = cleanStr(setting?.target_tukab || "");
  if (!apiKey || !target) {
    console.error("[sendAnalisaTukab] GAGAL: API Key/Target TUKAB belum diatur");
    return "ERROR: API Key/Target TUKAB belum diatur";
  }

  const perkUrl = `${Deno.env.get("SB_URL")}/functions/v1/perkiraan?action=rekap&tanggal=${tgl}&kodeWilayah=${kodeWilayah}&tglHariIni=${getWIBDateString()}`;
  const perkResp = await fetch(perkUrl, {
    headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` }
  });
  const perkJson = await perkResp.json();
  const rekap = perkJson?.data || {};
  const list = rekap.list || [];

  let tBon100 = 0, tBon50 = 0, tSetor100 = 0, tSetor50 = 0;
  let unitCount = 0;
  for (const r of list) {
    const b100 = Number(r.p100k_bon) || 0;
    const b50 = Number(r.p50k_bon) || 0;
    if (b100 > 0 || b50 > 0) unitCount++;
    tBon100 += b100;
    tBon50 += b50;
    tSetor100 += Number(r.p100k_setor) || 0;
    tSetor50 += Number(r.p50k_setor) || 0;
  }

  const khasanah100 = Number(rekap.khasanah100) || 0;
  const khasanah50 = Number(rekap.khasanah50) || 0;
  const saldo100 = khasanah100 + tSetor100;
  const saldo50 = khasanah50 + tSetor50;
  const kurang100 = Math.max(0, tBon100 - saldo100);
  const kurang50 = Math.max(0, tBon50 - saldo50);
  const grandKurang = kurang100 + kurang50;
  const totBon = tBon100 + tBon50;
  const totSaldo = saldo100 + saldo50;
  const surplus100 = Math.max(0, saldo100 - tBon100);
  const surplus50 = Math.max(0, saldo50 - tBon50);

  let msg = "*ANALISA KEBUTUHAN TUKAB*\n";
  msg += "Tanggal: " + formatTglIndo(tgl) + " (" + unitCount + " unit)\n";
  msg += "--------------------------------\n";

  msg += "💵 *Pecahan 100.000*\n";
  msg += "  📤 Kebutuhan Bon : Rp " + tBon100.toLocaleString("id-ID") + "\n";
  msg += "  📥 Saldo + Setoran: Rp " + saldo100.toLocaleString("id-ID") + "\n";
  if (kurang100 > 0) {
    msg += "  🔴 *Kekurangan:* Rp " + kurang100.toLocaleString("id-ID") + "\n";
  } else {
    msg += "  🟢 *Surplus:* Rp " + surplus100.toLocaleString("id-ID") + "\n";
  }
  msg += "\n";

  msg += "💵 *Pecahan 50.000*\n";
  msg += "  📤 Kebutuhan Bon : Rp " + tBon50.toLocaleString("id-ID") + "\n";
  msg += "  📥 Saldo + Setoran: Rp " + saldo50.toLocaleString("id-ID") + "\n";
  if (kurang50 > 0) {
    msg += "  🔴 *Kekurangan:* Rp " + kurang50.toLocaleString("id-ID") + "\n";
  } else {
    msg += "  🟢 *Surplus:* Rp " + surplus50.toLocaleString("id-ID") + "\n";
  }
  msg += "\n--------------------------------\n";

  if (grandKurang === 0) {
    msg += "✅ *STATUS: AMAN*\nSaldo Khasanah + Estimasi Setoran mencukupi seluruh kebutuhan Bon.\n";
  } else if (totSaldo >= totBon) {
    msg += "⚠️ *STATUS: MISMATCH PECAHAN*\n";
    msg += "Total dana mencukupi (Rp " + totSaldo.toLocaleString("id-ID") + " ≥ Rp " + totBon.toLocaleString("id-ID") + "),\n";
    msg += "namun terjadi ketidaksesuaian pecahan:\n\n";
    if (kurang100 > 0) {
      const lembarButuh = Math.ceil(kurang100 / 100000);
      msg += "🔴 *Butuh pecahan 100.000:* Rp " + kurang100.toLocaleString("id-ID") + " (" + lembarButuh.toLocaleString("id-ID") + " lembar)\n";
      if (surplus50 > 0) {
        const bisaDitukar = Math.min(surplus50, kurang100 * 2);
        const lembar50 = Math.floor(bisaDitukar / 50000);
        msg += "   💡 *Saran:* Tukar " + lembar50.toLocaleString("id-ID") + " lbr pecahan 50.000 (surplus)\n";
        msg += "   menjadi " + Math.floor(bisaDitukar / 100000).toLocaleString("id-ID") + " lbr pecahan 100.000\n";
      }
    }
    if (kurang50 > 0) {
      const lembarButuh = Math.ceil(kurang50 / 50000);
      msg += "🔴 *Butuh pecahan 50.000:* Rp " + kurang50.toLocaleString("id-ID") + " (" + lembarButuh.toLocaleString("id-ID") + " lembar)\n";
      if (surplus100 > 0) {
        const bisaDitukar = Math.min(surplus100, kurang50 * 2);
        const lembar100 = Math.floor(bisaDitukar / 100000);
        msg += "   💡 *Saran:* Tukar " + lembar100.toLocaleString("id-ID") + " lbr pecahan 100.000 (surplus)\n";
        msg += "   menjadi " + Math.floor(bisaDitukar / 50000).toLocaleString("id-ID") + " lbr pecahan 50.000\n";
      }
    }
    msg += "\n";
  } else {
    msg += "🚨 *STATUS: PERLU TUKAB*\n";
    msg += "Total dana TIDAK mencukupi (Rp " + totSaldo.toLocaleString("id-ID") + " < Rp " + totBon.toLocaleString("id-ID") + ")\n";
    msg += "Total kekurangan: *Rp " + grandKurang.toLocaleString("id-ID") + "*\n\n";
    msg += "📋 *Rincian Kebutuhan TUKAB:*\n";
    if (kurang100 > 0) {
      const lembar = Math.ceil(kurang100 / 100000);
      msg += "  • Pecahan 100.000: Rp " + kurang100.toLocaleString("id-ID") + " (" + lembar.toLocaleString("id-ID") + " lbr)\n";
    }
    if (kurang50 > 0) {
      const lembar = Math.ceil(kurang50 / 50000);
      msg += "  • Pecahan 50.000: Rp " + kurang50.toLocaleString("id-ID") + " (" + lembar.toLocaleString("id-ID") + " lbr)\n";
    }
    msg += "\n";
  }

  msg += "_from Cash Monitor Apps_";
  return waGatewaySend(apiKey, target, msg);
}

// =============================================
// SUMMARY PERKIRAAN H-1
// =============================================
async function sendPerkiraanH1(tgl: string, kodeWilayah: string, setting: any): Promise<string> {
  const apiKey = setting?.api_key;
  const target = cleanStr(setting?.target_perkiraan_h1 || "");
  if (!apiKey || !target) {
    console.error(`[sendPerkiraanH1] GAGAL: api_key=${!!apiKey}, target="${target}"`);
    return "ERROR: API Key/Target H-1 belum diatur — cek halaman Setting WA Gateway";
  }

  const todayISO = getWIBDateString();
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

  return waGatewaySend(apiKey, target, msg);
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
    if (!setting) return errorResponse("Setting WA Gateway belum diatur");

    const SCHEDULED_ACTIONS = ["scheduled-laporan-ht", "scheduled-perkiraan-h1"];
    if (!SCHEDULED_ACTIONS.includes(action) && setting.notif_enabled === false) {
      return successResponse("Notifikasi WA dinonaktifkan (toggle OFF di Setting WA Gateway)");
    }

    const kodeWilayah = body.kodeWilayah || "ALL";
    const tgl = body.tanggal || getWIBDateString();
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

      case "tukab": {
        const idTransaksi = body.idTransaksi || "-";
        const bank = body.bank || "-";
        const nominal = Number(body.nominal) || 0;
        const apiKey = setting?.api_key;
        const target = cleanStr(setting?.target_input_tukab || "");
        if (!apiKey || !target) return errorResponse("API Key/Target Input TUKAB belum diatur di Setting WA Gateway");
        const tukabMsg = `Mohon dibantu Input Tukab\n\n*ID: ${idTransaksi}*\n*Bank:* ${bank}\n*Nominal:* Rp. ${nominal.toLocaleString("id-ID")}\n\nTerima Kasih\n\n_from Cash Monitor Apps_`;
        result = await waGatewaySend(apiKey, target, tukabMsg);
        break;
      }

      case "scheduled-laporan-ht": {
        console.log(`[scheduled-laporan-ht] Triggered at ${new Date().toISOString()}`);
        const liburMap = await getLiburMap();
        const today = getWIBDateString();
        if (!isWorkingDay(today, liburMap)) {
          return successResponse("Hari libur/weekend, skip");
        }
        if (!setting?.api_key || !cleanStr(setting?.no_hp || "")) {
          return errorResponse("Setting Laporan HT belum lengkap (api_key/no_hp kosong)", 400);
        }
        result = await sendLaporanHT(today, "ALL", setting);
        break;
      }

      case "scheduled-perkiraan-h1": {
        console.log(`[scheduled-perkiraan-h1] Triggered at ${new Date().toISOString()}`);
        const liburMap = await getLiburMap();
        const today = getWIBDateString();
        if (!isWorkingDay(today, liburMap)) {
          return successResponse("Hari libur/weekend, skip");
        }
        if (!setting?.api_key || !cleanStr(setting?.target_perkiraan_h1 || "")) {
          return errorResponse("Setting Perkiraan H-1 belum lengkap (api_key/target_perkiraan_h1 kosong)", 400);
        }
        result = await sendPerkiraanH1(today, "ALL", setting);
        break;
      }

      default:
        return errorResponse("Invalid action: " + action);
    }

    if (typeof result === "string" && result.startsWith("ERROR:")) {
      console.error(`[notif-wa-gateway] Action ${action} failed: ${result}`);
      return errorResponse(result.replace("ERROR: ", ""), 400);
    }

    return successResponse(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[notif-wa-gateway] Exception: ${msg}`);
    return errorResponse("ERROR: " + msg, 500);
  }
});
