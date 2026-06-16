// Edge Function: /api/saldo-awal-ht
// Ported from: getSaldoAwalHT(), saveSaldoAwalHTBatch() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatSafeString } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const userEstim = url.searchParams.get("userEstim") ?? "";
    const tgl = url.searchParams.get("tanggal") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "";

    // GET
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("saldo_awal_ht")
        .select("*")
        .eq("tanggal", tgl)
        .eq("user_estim", userEstim)
        .eq("kode_wilayah", kodeWilayah);

      if (error) throw error;

      const res = (data || []).map((row: Record<string, unknown>) => {
        const pecVal = parseInt(String(row.pecahan));
        return {
          kategori: row.kategori,
          pecahan: isNaN(pecVal) ? row.pecahan : pecVal,
          lembar: parseInt(String(row.lembar)),
          nominal: parseFloat(String(row.nominal)),
        };
      });

      return successResponse(res);
    }

    // POST - Save batch
    if (req.method === "POST") {
      const rows = await req.json();

      if (!rows || rows.length === 0) {
        return successResponse("Empty");
      }

      // Delete existing entries for this date/user/wilayah combo
      const firstRow = rows[0];
      await supabase
        .from("saldo_awal_ht")
        .delete()
        .eq("tanggal", firstRow[0] || firstRow.tanggal)
        .eq("user_estim", cleanStr(firstRow[1] || firstRow.userEstim || firstRow.user_estim))
        .eq("kode_wilayah", cleanStr(firstRow[7] || firstRow.kodeWilayah || firstRow.kode_wilayah));

      // Insert new rows
      for (const row of rows) {
        const r = Array.isArray(row) ? row : [
          row.tanggal, row.userEstim || row.user_estim, row.kategori,
          row.pecahan, row.lembar, row.nominal,
          row.kodeCabang || row.kode_cabang, row.kodeWilayah || row.kode_wilayah,
        ];

        const nominal = parseFloat(String(r[5])) || 0;
        if (nominal <= 0) continue;

        await supabase.from("saldo_awal_ht").insert({
          tanggal: r[0],
          user_estim: String(r[1]).replace(/^'/, ""),
          kategori: r[2],
          pecahan: String(r[3]).replace(/^'/, ""),
          lembar: parseInt(String(r[4])) || 0,
          nominal,
          kode_cabang: String(r[6] || "").replace(/^'/, ""),
          kode_wilayah: String(r[7] || "").replace(/^'/, ""),
        });
      }

      return successResponse("Saved");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
