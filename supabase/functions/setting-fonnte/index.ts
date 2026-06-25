// Edge Function: /api/setting-fonnte
// Ported from: getSettingFonnte(), saveSettingFonnte() in Code.gs

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
        .from("setting_fonnte")
        .select("*")
        .order("id")
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) return successResponse(null);

      const formatJam = (val: unknown, defaultVal: string): string => {
        if (!val) return defaultVal;
        if (val instanceof Date) {
          return val.toTimeString().substring(0, 5);
        }
        return String(val).substring(0, 5);
      };

      return successResponse({
        token: String(data.token || ""),
        noHp: String(data.no_hp || "").replace(/'/g, ""),
        waktu: formatJam(data.waktu, "16:00"),
        tokenKF: String(data.token_kf || ""),
        targetKF: String(data.target_kf || "").replace(/'/g, ""),
        targetTukab: String(data.target_tukab || "").replace(/'/g, ""),
        targetInputTukab: String(data.target_input_tukab || "").replace(/'/g, ""),
        waktuPerkiraanH1: formatJam(data.waktu_perkiraan_h1, "07:00"),
        targetPerkiraanH1: String(data.target_perkiraan_h1 || "").replace(/'/g, ""),
        targetPosisiKas: String(data.target_posisi_kas || "").replace(/'/g, ""),
        notifEnabled: data.notif_enabled !== undefined ? data.notif_enabled : true,
      });
    }

    // POST - Save
    if (req.method === "POST") {
      const obj = await req.json();

      // Always use 'ALL' wilayah (single global setting)
      const record = {
        kode_wilayah: "ALL",
        token: obj.token || "",
        no_hp: obj.noHp ? cleanStr(obj.noHp) : "",
        waktu: obj.waktu || "16:00",
        token_kf: obj.tokenKF || "",
        target_kf: obj.targetKF ? cleanStr(obj.targetKF) : "",
        target_tukab: obj.targetTukab ? cleanStr(obj.targetTukab) : "",
        target_input_tukab: obj.targetInputTukab ? cleanStr(obj.targetInputTukab) : "",
        waktu_perkiraan_h1: obj.waktuPerkiraanH1 || "07:00",
        target_perkiraan_h1: obj.targetPerkiraanH1 ? cleanStr(obj.targetPerkiraanH1) : "",
        target_posisi_kas: obj.targetPosisiKas ? cleanStr(obj.targetPosisiKas) : "",
        notif_enabled: obj.notifEnabled !== undefined ? obj.notifEnabled : true,
      };

      // Delete existing rows beyond the first, then upsert
      const { data: existing } = await supabase.from("setting_fonnte").select("id").order("id");

      if (existing && existing.length > 0) {
        await supabase.from("setting_fonnte").update(record).eq("id", existing[0].id);
      } else {
        await supabase.from("setting_fonnte").insert(record);
      }

      return successResponse(true);
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
