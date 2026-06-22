// Edge Function: /api/data-atm
// Kelola data ATM (nama ATM + denom) per KF/Teller

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const userEstim = url.searchParams.get("userEstim") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";

    // GET - List ATM (by userEstim atau all untuk wilayah)
    if (req.method === "GET") {
      let query = supabase.from("db_atm").select("*").order("id", { ascending: true });

      if (action === "my") {
        // ATM milik user tertentu (untuk dropdown CIT ATM)
        if (!userEstim) return errorResponse("Missing userEstim");
        query = query.eq("user_estim", userEstim);
      } else if (kodeWilayah !== "ALL") {
        query = query.eq("kode_wilayah", kodeWilayah);
      }

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []).map(row => ({
        id: row.id,
        userEstim: cleanStr(row.user_estim),
        namaAtm: cleanStr(row.nama_atm),
        denom: String(row.denom),
        kodeWilayah: cleanStr(row.kode_wilayah),
        kodeCabang: cleanStr(row.kode_cabang || ""),
      }));

      return successResponse({ list });
    }

    // POST - Simpan data ATM baru
    if (req.method === "POST") {
      const body = await req.json();
      const isEdit = body.id != null;

      const record = {
        kode_wilayah: body.kodeWilayah || body.kode_wilayah || "",
        kode_cabang: body.kodeCabang || body.kode_cabang || "",
        user_estim: body.userEstim || body.user_estim || "",
        nama_atm: body.namaAtm || body.nama_atm || "",
        denom: body.denom || "100000",
      };

      if (!record.user_estim || !record.nama_atm) {
        return errorResponse("userEstim dan namaAtm wajib diisi");
      }

      if (isEdit) {
        const { error } = await supabase.from("db_atm").update(record).eq("id", body.id);
        if (error) throw error;
        return successResponse("Updated");
      } else {
        const { error } = await supabase.from("db_atm").insert(record);
        if (error) throw error;
        return successResponse("Saved");
      }
    }

    // DELETE - Hapus data by ID (from path: /data-atm/123)
    if (req.method === "DELETE") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      const idFromPath = pathParts.length > 1 ? pathParts[1] : null;
      const idParam = url.searchParams.get("id") || idFromPath;
      if (!idParam) return errorResponse("Missing id parameter");
      const { error } = await supabase.from("db_atm").delete().eq("id", parseInt(idParam));
      if (error) throw error;
      return successResponse("Deleted");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    let msg = "Unknown error";
    if (e instanceof Error) msg = e.message;
    else if (e && typeof e === "object") msg = JSON.stringify(e);
    else msg = String(e);
    console.error("[data-atm] Error:", msg);
    return errorResponse("ERROR: " + msg, 500);
  }
});
