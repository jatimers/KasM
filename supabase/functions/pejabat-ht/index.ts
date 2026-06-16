// Edge Function: /api/pejabat-ht
// Ported from: getDataPejabatHT(), saveDataPejabatHT() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

interface PejabatHTData {
  kodeWilayah: string;
  nipPenyelia: string;
  namaPenyelia: string;
  nipPBO: string;
  namaPBO: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "";

    // GET
    if (req.method === "GET") {
      if (!kodeWilayah) {
        // Return all
        const { data, error } = await supabase.from("data_pejabat_ht").select("*");
        if (error) throw error;
        return successResponse(data);
      }

      const { data, error } = await supabase
        .from("data_pejabat_ht")
        .select("*")
        .eq("kode_wilayah", kodeWilayah)
        .maybeSingle();

      if (error) throw error;

      if (!data) return successResponse(null);

      return successResponse({
        nipPenyelia: data.nip_penyelia,
        namaPenyelia: data.nama_penyelia,
        nipPBO: data.nip_pbo,
        namaPBO: data.nama_pbo,
      });
    }

    // POST - Save
    if (req.method === "POST") {
      const obj: PejabatHTData = await req.json();

      const { data: existing } = await supabase
        .from("data_pejabat_ht")
        .select("id")
        .eq("kode_wilayah", obj.kodeWilayah)
        .maybeSingle();

      const record = {
        kode_wilayah: obj.kodeWilayah,
        nip_penyelia: obj.nipPenyelia,
        nama_penyelia: obj.namaPenyelia,
        nip_pbo: obj.nipPBO,
        nama_pbo: obj.namaPBO,
      };

      if (existing) {
        await supabase.from("data_pejabat_ht").update(record).eq("id", existing.id);
        return successResponse("Updated");
      } else {
        await supabase.from("data_pejabat_ht").insert(record);
        return successResponse("Saved");
      }
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
