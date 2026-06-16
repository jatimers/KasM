// Edge Function: /api/tutup-buku
// Ported from: tutupBukuHT() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatSafeString } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const supabase = getSupabaseClient(req);
    const body = await req.json();
    const tglHariIni: string = body.tanggal;
    const kodeWilayah: string = body.kodeWilayah || "ALL";

    if (!tglHariIni) return errorResponse("Missing tanggal parameter");

    // Get snapshots (paginated)
    let htData: any[] = [];
    let sStart = 0, sSize = 900;
    while (true) {
      const { data: page } = await supabase.from("saldo_awal_ht").select("*")
        .lte("tanggal", tglHariIni).range(sStart, sStart + sSize - 1);
      if (!page || page.length === 0) break;
      htData = htData.concat(page);
      if (page.length < sSize) break;
      sStart += sSize;
    }

    const snapshots = (htData || []).filter(
      (s) => kodeWilayah === "ALL" || cleanStr(s.kode_wilayah as string) === kodeWilayah
    );
    snapshots.sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));

    const rincianNominal: Record<string, number> = {};
    let latestSnapshotDate = "";

    if (snapshots.length > 0) {
      latestSnapshotDate = formatSafeString(snapshots[0].tanggal);
      for (const s of snapshots) {
        if (formatSafeString(s.tanggal) === latestSnapshotDate) {
          const key = cleanStr(s.kategori as string) + "_" + cleanStr(String(s.pecahan));
          rincianNominal[key] = (rincianNominal[key] || 0) + (parseFloat(String(s.nominal)) || 0);
        }
      }
    }

    // Get bon_setor data (paginated to bypass 1000-row limit)
    let bonData: any[] = [];
    let bStart = 0, bSize = 900;
    while (true) {
      const { data: page } = await supabase.from("bon_setor").select("*")
        .range(bStart, bStart + bSize - 1).order("tanggal");
      if (!page || page.length === 0) break;
      bonData = bonData.concat(page);
      if (page.length < bSize) break;
      bStart += bSize;
    }

    const rowsToArchive: Record<string, unknown>[] = [];
    const idsToDelete: string[] = [];

    for (const row of (bonData || [])) {
      const rowWilayah = cleanStr(row.kode_wilayah);
      if (kodeWilayah !== "ALL" && rowWilayah !== kodeWilayah) continue;

      const tglTrx = formatSafeString(row.tanggal);
      if (tglTrx <= tglHariIni) {
        rowsToArchive.push({ ...row });
        idsToDelete.push(row.id_transaksi);

        if (tglTrx >= latestSnapshotDate) {
          const scope = row.scope || "KHASANAH";
          if (scope === "KHASANAH") {
            const tipe = row.tipe;
            const nominal = parseFloat(String(row.nominal)) || 0;
            const key = cleanStr(row.kategori) + "_" + cleanStr(String(row.pecahan));
            const isBon = ["BON PAGI", "BON TAMBAHAN", "BON"].includes(tipe);
            const isSetor = ["SETOR SORE", "SETOR TAMBAHAN", "SETOR"].includes(tipe);
            const pengali = isBon ? -1 : (isSetor ? 1 : 0);
            rincianNominal[key] = (rincianNominal[key] || 0) + (nominal * pengali);
          }
        }
      }
    }

    // Archive bon_setor rows
    if (rowsToArchive.length > 0) {
      await supabase.from("arsip_bon_setor").insert(rowsToArchive);
      for (const id of idsToDelete) {
        await supabase.from("bon_setor").delete().eq("id_transaksi", id);
      }
    }

    // Calculate next day
    const parts = tglHariIni.split("-");
    const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    dateObj.setDate(dateObj.getDate() + 1);
    const tglBesok = dateObj.toISOString().split("T")[0];

    // Save new saldo_awal_ht for next day
    for (const k in rincianNominal) {
      if (rincianNominal[k] > 0) {
        const p = k.split("_");
        const kategori = p[0];
        const pecahanStr = p[1];
        const nominalTotal = rincianNominal[k];
        const pecNum = parseInt(pecahanStr);
        const isStr = isNaN(pecNum);
        const lembarHitung = isStr ? 1 : Math.floor(nominalTotal / pecNum);
        const valPecahan = isStr ? pecahanStr : String(pecNum);

        await supabase.from("saldo_awal_ht").insert({
          tanggal: tglBesok,
          user_estim: "ARSIP_SISTEM",
          kategori,
          pecahan: valPecahan,
          lembar: lembarHitung,
          nominal: nominalTotal,
          kode_cabang: "ALL",
          kode_wilayah: kodeWilayah,
        });
      }
    }

    return successResponse(true);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
