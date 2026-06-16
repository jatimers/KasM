// Edge Function: /api/dashboard
// Ported from: getDashboardData(), getRekapHeadTeller() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const userEstim = url.searchParams.get("userEstim") ?? "";
    const tgl = url.searchParams.get("tanggal") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";

    // Dashboard HT
    if (url.searchParams.get("type") === "ht") {
      const { data: bonData } = await supabase
        .from("bon_setor")
        .select("*")
        .eq("tanggal", tgl);

      let totalBon = 0, totalSetor = 0, saldoAwal = 0;

      for (const row of (bonData || [])) {
        const rowWilayah = cleanStr(row.kode_wilayah);
        if (kodeWilayah !== "ALL" && rowWilayah !== kodeWilayah) continue;

        const scope = row.scope || "KHASANAH";
        if (scope !== "KHASANAH") continue;

        const tipe = row.tipe;
        const nominal = parseFloat(String(row.nominal)) || 0;

        if (["BON PAGI", "BON TAMBAHAN", "BON"].includes(tipe)) totalBon += nominal;
        if (["SETOR SORE", "SETOR TAMBAHAN", "SETOR"].includes(tipe)) totalSetor += nominal;
      }

      return successResponse({
        saldoAwal,
        totalBonTeller: totalBon,
        totalSetorTeller: totalSetor,
        saldoAkhirKhasanah: saldoAwal - totalBon + totalSetor,
      });
    }

    // Dashboard Teller/KF
    const { data: bonData } = await supabase
      .from("bon_setor")
      .select("*")
      .eq("user_estim", userEstim)
      .eq("tanggal", tgl);

    let tBon = 0, tSetor = 0, tTerima = 0, tBayar = 0;

    for (const row of (bonData || [])) {
      const scope = normalizeUnit(row.scope || "KHASANAH");
      if (scope !== "HEAD TELLER") continue;

      const t = row.tipe;
      const nom = parseFloat(String(row.nominal)) || 0;

      if (["BON PAGI", "BON TAMBAHAN", "BON", "SALDO AWAL"].includes(t)) tBon += nom;
      else if (["SETOR SORE", "SETOR TAMBAHAN", "SETOR"].includes(t)) tSetor += nom;
      else if (["PENERIMAAN KAS", "PENERIMAAN ANTAR TELLER"].includes(t)) tTerima += nom;
      else if (["PEMBAYARAN KAS", "PEMBAYARAN ANTAR TELLER"].includes(t)) tBayar += nom;
    }

    return successResponse({
      bonMasuk: tBon,
      setorKeluar: tSetor,
      penerimaan: tTerima,
      pembayaran: tBayar,
      saldoEstimasi: tBon + tTerima - tBayar - tSetor,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
