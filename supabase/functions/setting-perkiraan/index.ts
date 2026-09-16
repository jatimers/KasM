// Edge Function: /api/setting-perkiraan
// Pengaturan batas waktu input Perkiraan Bon (cutoff) + toggle on/off

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

const DEFAULT_TIME = "12:00";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);

    // GET
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("setting_perkiraan")
        .select("*")
        .order("id")
        .limit(1);

      if (error) throw error;
      const row = (data && data.length > 0) ? data[0] : null;
      if (!row) return successResponse({ cutoffEnabled: true, cutoffTime: DEFAULT_TIME });

      return successResponse({
        cutoffEnabled: row.cutoff_enabled !== false,
        cutoffTime: cleanStr(row.cutoff_time) || DEFAULT_TIME,
      });
    }

    // POST - Save (upsert single row)
    if (req.method === "POST") {
      const obj = await req.json();

      const record: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (obj.cutoffEnabled !== undefined) {
        record.cutoff_enabled = !!obj.cutoffEnabled;
      }

      if (obj.cutoffTime !== undefined) {
        const t = cleanStr(obj.cutoffTime);
        record.cutoff_time = /^([01]\d|2[0-3]):([0-5]\d)$/.test(t) ? t : DEFAULT_TIME;
      }

      const { data: existing } = await supabase
        .from("setting_perkiraan").select("id").order("id").limit(1);

      if (existing && existing.length > 0) {
        await supabase.from("setting_perkiraan").update(record).eq("id", existing[0].id);
      } else {
        await supabase.from("setting_perkiraan").insert(record);
      }

      return successResponse(true);
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
