// Edge Function: /api/hari-libur
// Ported from: getListHariLibur(), saveHariLibur(), deleteHariLibur() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { formatSafeString } from "../_shared/utils.ts";

interface HariLiburData {
  tanggal: string;
  keterangan: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const tgl = pathParts.length > 2 ? decodeURIComponent(pathParts[2]) : null;

    // GET - List all
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("hari_libur")
        .select("*")
        .order("tanggal");

      if (error) throw error;

      const res = (data || []).map((d: Record<string, unknown>) => ({
        tanggal: formatSafeString(d.tanggal),
        keterangan: d.keterangan,
      }));

      return successResponse(res);
    }

    // POST - Save (insert or update)
    if (req.method === "POST") {
      const obj: HariLiburData = await req.json();

      const { data: existing } = await supabase
        .from("hari_libur")
        .select("id")
        .eq("tanggal", obj.tanggal)
        .maybeSingle();

      if (existing) {
        await supabase.from("hari_libur").update({ keterangan: obj.keterangan }).eq("id", existing.id);
        return successResponse("Updated");
      } else {
        await supabase.from("hari_libur").insert({ tanggal: obj.tanggal, keterangan: obj.keterangan });
        return successResponse("Saved");
      }
    }

    // DELETE - Delete by date
    if (req.method === "DELETE" && tgl) {
      const { error } = await supabase.from("hari_libur").delete().eq("tanggal", tgl);
      if (error) throw error;
      return successResponse("Deleted");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
