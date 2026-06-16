// Edge Function: /api/notif-fonnte
// Ported from: sendLaporanHTFonnte(), sendSummaryPerkiraanKF(),
//   sendAnalisaTukabWA(), sendNotifPosisiKasWA(), sendSummaryPerkiraanH1WA() in Code.gs
// Note: Actual WhatsApp sending is done via Fonnte API

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatTglIndo } from "../_shared/utils.ts";

async function fonnteSend(token: string, target: string, message: string): Promise<string> {
  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { "Authorization": token },
    body: new URLSearchParams({ target, message }),
  });
  return response.text();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const supabase = getSupabaseClient(req);
    const body = await req.json();
    const action: string = body.action ?? "laporan-ht";

    // Get settings
    const { data: setting } = await supabase
      .from("setting_fonnte")
      .select("*")
      .order("id")
      .limit(1)
      .maybeSingle();

    if (!setting) return errorResponse("Setting Fonnte belum diatur");

    // Send Laporan HT
    if (action === "laporan-ht") {
      const tgl: string = body.tanggal;
      const kodeWilayah: string = body.kodeWilayah || "ALL";
      const token: string = body.token || setting.token;
      const targetHp: string = body.target || cleanStr(setting.no_hp);

      if (!token || !targetHp) return errorResponse("Token atau No HP belum diatur");

      // Get laporan data (simplified)
      const msg = `*LAPORAN POSISI KHASANAH*\nTanggal: ${formatTglIndo(tgl)}\n\n_data from Cash Monitor App_`;
      const result = await fonnteSend(token, targetHp.replace(/\s+/g, ""), msg);
      return successResponse(result);
    }

    // Send Summary Perkiraan KF
    if (action === "perkiraan-kf") {
      const tgl: string = body.tanggal;
      const token: string = body.token || setting.token_kf;
      const targetKf: string = body.target || cleanStr(setting.target_kf);

      if (!token || !targetKf) return errorResponse("Token KF atau Target belum diatur");

      const msg = `*REKAP PERKIRAAN BON/SETOR*\nTanggal: ${formatTglIndo(tgl)}\n\n_from Cash Monitor Apps_`;
      const result = await fonnteSend(token, targetKf.replace(/\s+/g, ""), msg);
      return successResponse(result);
    }

    // Send Analisa TUKAB
    if (action === "analisa-tukab") {
      const tgl: string = body.tanggal;
      const token: string = body.token || setting.token_kf;
      const targetTukab: string = body.target || cleanStr(setting.target_tukab);

      if (!token || !targetTukab) return errorResponse("Token KF atau Target TUKAB belum diatur");

      const msg = `*ANALISA KEBUTUHAN TUKAB*\nTanggal: ${formatTglIndo(tgl)}\n\n_from Cash Monitor Apps_`;
      const result = await fonnteSend(token, targetTukab.replace(/\s+/g, ""), msg);
      return successResponse(result);
    }

    // Send Notif Posisi Kas
    if (action === "posisi-kas") {
      const dataObj = body.data;
      const token: string = body.token || setting.token_kf;
      const target: string = body.target || cleanStr(setting.target_posisi_kas);

      if (!token || !target) return errorResponse("Token atau Target Posisi Kas belum diatur");

      const msg = `*LAPORAN POSISI KAS KF*\nTanggal: ${formatTglIndo(dataObj.Tanggal)}\nUnit: ${dataObj.NamaUnit || "-"}\nSelisih: Rp ${Number(dataObj.SelisihPembulatan || 0).toLocaleString("id-ID")}\n\n_from Cash Monitor Apps_`;
      const result = await fonnteSend(token, target.replace(/\s+/g, ""), msg);
      return successResponse(result);
    }

    // Send Summary Perkiraan H1
    if (action === "perkiraan-h1") {
      const tgl: string = body.tanggal;
      const token: string = body.token || setting.token_kf;
      const targetH1: string = body.target || cleanStr(setting.target_perkiraan_h1);

      if (!token || !targetH1) return errorResponse("Token atau Target H-1 belum diatur");

      const msg = `*SUMMARY KEBUTUHAN BON*\nTanggal: ${formatTglIndo(tgl)}\n\n_from Cash Monitor Apps_`;
      const result = await fonnteSend(token, targetH1.replace(/\s+/g, ""), msg);
      return successResponse(result);
    }

    return errorResponse("Invalid action: " + action);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
