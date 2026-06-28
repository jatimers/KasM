// Edge Function: /api/setting-wa-gateway
// Migrated from setting-fonnte — Fonnte → WhatsApp Gateway (wa.matradata.com)
// Date: 2026-06-28

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
        .from("setting_wa_gateway")
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
        apiKey: String(data.api_key || ""),
        noHp: String(data.no_hp || "").replace(/'/g, ""),
        waktu: formatJam(data.waktu, "16:00"),
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

      const record = {
        kode_wilayah: "ALL",
        api_key: obj.apiKey || "",
        no_hp: obj.noHp ? cleanStr(obj.noHp) : "",
        waktu: obj.waktu || "16:00",
        target_kf: obj.targetKF ? cleanStr(obj.targetKF) : "",
        target_tukab: obj.targetTukab ? cleanStr(obj.targetTukab) : "",
        target_input_tukab: obj.targetInputTukab ? cleanStr(obj.targetInputTukab) : "",
        waktu_perkiraan_h1: obj.waktuPerkiraanH1 || "07:00",
        target_perkiraan_h1: obj.targetPerkiraanH1 ? cleanStr(obj.targetPerkiraanH1) : "",
        target_posisi_kas: obj.targetPosisiKas ? cleanStr(obj.targetPosisiKas) : "",
        notif_enabled: obj.notifEnabled !== undefined ? obj.notifEnabled : true,
      };

      const { data: existing } = await supabase.from("setting_wa_gateway").select("id").order("id");

      if (existing && existing.length > 0) {
        await supabase.from("setting_wa_gateway").update(record).eq("id", existing[0].id);
      } else {
        await supabase.from("setting_wa_gateway").insert(record);
      }

      return successResponse(true);
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
