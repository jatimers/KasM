// Edge Function: /api/tukab
// Input, Rekap, Delete data TUKAB

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

    // DELETE
    if (req.method === "DELETE") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      const idFromPath = pathParts.length > 1 ? pathParts[1] : null;
      const idParam = url.searchParams.get("id") || idFromPath;
      if (!idParam) return errorResponse("Missing id parameter");
      const { error } = await supabase.from("db_tukab").delete().eq("id", parseInt(idParam));
      if (error) throw error;
      return successResponse("Deleted");
    }

    // GET - Rekap per bulan (Head Teller)
    if (req.method === "GET" && action === "rekap") {
      if (!bulan) return errorResponse("Missing bulan parameter");

      const parts = bulan.split("-").map(Number);
      const lastDay = new Date(parts[0], parts[1], 0).getDate();
      const endDate = bulan + "-" + String(lastDay).padStart(2, "0");

      let query = supabase
        .from("db_tukab")
        .select("*")
        .gte("tgl_transaksi", bulan + "-01")
        .lte("tgl_transaksi", endDate)
        .order("tgl_transaksi", { ascending: true })
        .order("id", { ascending: true });

      // Hanya tampil yg BELUM diantar (status_antar = false) → masuk CIT
      query = query.eq("status_antar", false);
      if (kodeWilayah !== "ALL") query = query.eq("kode_wilayah", kodeWilayah);

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []).map((row, idx) => ({
        id: row.id,
        no: idx + 1,
        tglTransaksi: String(row.tgl_transaksi).substring(0, 10),
        bank: cleanStr(row.bank),
        nominalTukab: parseInt(String(row.nominal_tukab)) || 0,
        userEstim: cleanStr(row.user_estim),
        statusAntar: row.status_antar === true,
      }));

      const grandTotal = list.reduce((s, r) => s + r.nominalTukab, 0);
      return successResponse({ bulan, list, grandTotal });
    }

    // GET - History (untuk input page)
    if (req.method === "GET" && action === "history") {
      const tgl = url.searchParams.get("tanggal") ?? "";
      let query = supabase
        .from("db_tukab")
        .select("*")
        .order("id", { ascending: false })
        .limit(50);

      if (tgl) query = query.eq("tgl_transaksi", tgl);
      if (kodeWilayah !== "ALL") query = query.eq("kode_wilayah", kodeWilayah);

      const { data, error } = await query;
      if (error) throw error;

      const list = (data || []).map((row, idx) => ({
        id: row.id,
        no: idx + 1,
        tglTransaksi: String(row.tgl_transaksi).substring(0, 10),
        bank: cleanStr(row.bank),
        nominalTukab: parseInt(String(row.nominal_tukab)) || 0,
        userEstim: cleanStr(row.user_estim),
        statusAntar: row.status_antar === true,
      }));

      return successResponse({ list });
    }

    // POST - Simpan data
    if (req.method === "POST") {
      const body = await req.json();
      const isEdit = body.id != null;

      const record: Record<string, unknown> = {
        tgl_transaksi: body.tglTransaksi || body.tgl_transaksi || getWIBDateString(),
        bank: body.bank || "",
        nominal_tukab: parseInt(String(body.nominalTukab || body.nominal_tukab)) || 0,
        status_antar: body.statusAntar === true || body.status_antar === true,
        user_estim: body.userEstim || body.user_estim || "",
        kode_wilayah: body.kodeWilayah || body.kode_wilayah || "",
        kode_cabang: body.kodeCabang || body.kode_cabang || "",
      };

      if (!record.bank || !record.nominal_tukab) {
        return errorResponse("Bank dan nominal wajib diisi");
      }

      if (isEdit) {
        const { error } = await supabase.from("db_tukab").update(record).eq("id", body.id);
        if (error) throw error;
        return successResponse("Updated");
      } else {
        const { data: inserted, error } = await supabase.from("db_tukab").insert(record).select("id");
        if (error) throw error;
        const newId = inserted?.[0]?.id ?? null;
        return successResponse({ id: newId, saved: true });
      }
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    let msg = "Unknown error";
    if (e instanceof Error) msg = e.message;
    else if (e && typeof e === "object") msg = JSON.stringify(e);
    else msg = String(e);
    console.error("[tukab] Error:", msg);
    return errorResponse("ERROR: " + msg, 500);
  }
});
