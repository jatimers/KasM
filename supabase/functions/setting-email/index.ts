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
