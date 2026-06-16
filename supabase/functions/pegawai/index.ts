// Edge Function: /api/pegawai
// Ported from: getDataPegawai(), saveDataPegawai() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

interface PegawaiData {
  userEstimTeller: string;
  nipTeller: string;
  namaTeller: string;
  nipPimkas: string;
  namaPimkas: string;
  userEstimPimkas: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const userEstim = url.searchParams.get("userEstim") ?? "";

    // GET - Get pegawai by user_estim_teller
    if (req.method === "GET") {
      if (!userEstim) {
        // Return all
        const { data, error } = await supabase.from("data_pegawai").select("*");
        if (error) throw error;
        return successResponse(data);
      }

      const { data, error } = await supabase
        .from("data_pegawai")
        .select("*")
        .eq("user_estim_teller", userEstim)
        .maybeSingle();

      if (error) throw error;

      if (!data) return successResponse(null);

      return successResponse({
        nipTeller: data.nip_teller,
        namaTeller: data.nama_teller,
        nipPimkas: data.nip_pimkas,
        namaPimkas: data.nama_pimkas,
        userEstimPimkas: cleanStr(data.user_estim_pimkas),
      });
    }

    // POST - Save pegawai
    if (req.method === "POST") {
      const obj: PegawaiData = await req.json();

      const { data: existing } = await supabase
        .from("data_pegawai")
        .select("id")
        .eq("user_estim_teller", obj.userEstimTeller)
        .maybeSingle();

      const record = {
        user_estim_teller: obj.userEstimTeller,
        nip_teller: obj.nipTeller,
        nama_teller: obj.namaTeller,
        nip_pimkas: obj.nipPimkas,
        nama_pimkas: obj.namaPimkas,
        user_estim_pimkas: obj.userEstimPimkas,
      };

      if (existing) {
        await supabase.from("data_pegawai").update(record).eq("id", existing.id);
        return successResponse("Updated");
      } else {
        await supabase.from("data_pegawai").insert(record);
        return successResponse("Saved");
      }
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
