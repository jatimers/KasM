// Edge Function: /api/cit-atm
// Input, Rekap, Edit, Delete data CIT ATM

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, getWIBDateString } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";
    const bulan = url.searchParams.get("bulan") ?? "";
    const userEstim = url.searchParams.get("userEstim") ?? "";

    // DELETE - Hapus data by ID
    if (req.method === "DELETE") {
      const idParam = url.searchParams.get("id");
      if (!idParam) return errorResponse("Missing id parameter");

      const { error } = await supabase.from("db_cit_atm").delete().eq("id", parseInt(idParam));
      if (error) throw error;
      return successResponse("Deleted");
    }

    // GET - Rekap per bulan (Head Teller)
    if (req.method === "GET" && action === "rekap") {
      if (!bulan) return errorResponse("Missing bulan parameter (YYYY-MM)");

      let query = supabase
        .from("db_cit_atm")
        .select("*")
        .gte("tgl_transaksi", bulan + "-01")
        .lte("tgl_transaksi", bulan + "-31")
        .order("tgl_transaksi", { ascending: true })
        .order("id", { ascending: true });

      if (kodeWilayah !== "ALL") {
        query = query.eq("kode_wilayah", kodeWilayah);
      }

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []).map((row, idx) => ({
        id: row.id,
        no: idx + 1,
        tglTransaksi: String(row.tgl_transaksi).substring(0, 10),
        userAtm: cleanStr(row.user_atm),
        nominalPengisian: parseInt(String(row.nominal_pengisian)) || 0,
        kodeCabang: cleanStr(row.kode_cabang),
      }));

      const grandTotal = list.reduce((sum, r) => sum + r.nominalPengisian, 0);
      return successResponse({ bulan, list, grandTotal });
    }

    // GET - History transaksi terbaru (untuk input page: tampil + edit/delete)
    if (req.method === "GET" && action === "history") {
      let query = supabase
        .from("db_cit_atm")
        .select("*")
        .order("id", { ascending: false })
        .limit(50);

      if (kodeWilayah !== "ALL") {
        query = query.eq("kode_wilayah", kodeWilayah);
      }

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []).map((row, idx) => ({
        id: row.id,
        no: idx + 1,
        tglTransaksi: String(row.tgl_transaksi).substring(0, 10),
        userAtm: cleanStr(row.user_atm),
        nominalPengisian: parseInt(String(row.nominal_pengisian)) || 0,
        kodeCabang: cleanStr(row.kode_cabang),
      }));

      return successResponse({ list });
    }

    // POST - Simpan data baru
    if (req.method === "POST") {
      const body = await req.json();
      const isEdit = body.id != null;

      const record: Record<string, unknown> = {
        kode_wilayah: body.kodeWilayah || body.kode_wilayah || "",
        kode_cabang: body.kodeCabang || body.kode_cabang || "",
        tgl_transaksi: body.tglTransaksi || body.tgl_transaksi || getWIBDateString(),
        user_atm: body.userAtm || body.user_atm || "",
        nominal_pengisian: parseInt(String(body.nominalPengisian || body.nominal_pengisian)) || 0,
      };

      if (!record.kode_wilayah || !record.user_atm) {
        return errorResponse("kodeWilayah dan userAtm wajib diisi");
      }

      if (isEdit) {
        const { error } = await supabase.from("db_cit_atm").update(record).eq("id", body.id);
        if (error) throw error;
        return successResponse("Updated");
      } else {
        const { error } = await supabase.from("db_cit_atm").insert(record);
        if (error) throw error;
        return successResponse("Saved");
      }
    }

    return errorResponse("Method not allowed or invalid action", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cit-atm] Error:", msg);
    return errorResponse("ERROR: " + msg, 500);
  }
});
