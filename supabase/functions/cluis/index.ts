// Edge Function: /api/cluis
// Ported from: getLapCluis() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatSafeString } from "../_shared/utils.ts";

const configKeys: Record<string, (number | string)[]> = {
  "ULE": [100000, 75000, 50000, 20000, 10000, 5000, 2000, 1000],
  "Uang Logam": [1000, 500, 200, 100, 50],
  "UTLE": [100000, 75000, 50000, 20000, 10000, 5000, 2000, 1000],
  "HCS": [100000, 75000, 50000, 20000, 10000, 5000, 2000, 1000],
};
const catOrder: Record<string, number> = { "ULE": 1, "Uang Logam": 2, "UTLE": 3, "HCS": 4 };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const tgl = url.searchParams.get("tanggal") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";

    if (!tgl) return errorResponse("Missing tanggal parameter");

    // Initialize maps
    const rincianSebelumnya: Record<string, number> = {};
    const pengeluaranHariIni: Record<string, number> = {};

    for (const cat in configKeys) {
      for (const pec of configKeys[cat]) {
        rincianSebelumnya[cat + "_" + pec] = 0;
        pengeluaranHariIni[cat + "_" + pec] = 0;
      }
    }

    // Get snapshot data (paginated)
    let snapshots: any[] = [];
    let spStart = 0, spSize = 900;
    while (true) {
      const { data: page } = await supabase.from("saldo_awal_ht").select("*")
        .lte("tanggal", tgl).range(spStart, spStart + spSize - 1);
      if (!page || page.length === 0) break;
      snapshots = snapshots.concat(page);
      if (page.length < spSize) break;
      spStart += spSize;
    }

    const filteredSnapshots = snapshots.filter(
      (s) => kodeWilayah === "ALL" || cleanStr(s.kode_wilayah as string) === kodeWilayah
    );
    filteredSnapshots.sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));

    let latestSnapshotDate = "";
    if (filteredSnapshots.length > 0) {
      latestSnapshotDate = formatSafeString(filteredSnapshots[0].tanggal);
      for (const s of filteredSnapshots) {
        if (formatSafeString(s.tanggal) === latestSnapshotDate) {
          const key = cleanStr(s.kategori as string) + "_" + cleanStr(String(s.pecahan));
          if (rincianSebelumnya[key] !== undefined) {
            rincianSebelumnya[key] += parseFloat(String(s.nominal)) || 0;
          }
        }
      }
    }

    // Get bon_setor mutations (paginated to bypass 1000-row limit)
    let bonData: any[] = [];
    let bsStart = 0, bsSize = 900;
    while (true) {
      const { data: page } = await supabase.from("bon_setor").select("*")
        .range(bsStart, bsStart + bsSize - 1).order("tanggal");
      if (!page || page.length === 0) break;
      bonData = bonData.concat(page);
      if (page.length < bsSize) break;
      bsStart += bsSize;
    }

    for (const row of (bonData || [])) {
      const rowWilayah = cleanStr(row.kode_wilayah);
      if (kodeWilayah !== "ALL" && rowWilayah !== kodeWilayah) continue;

      const scope = row.scope || "KHASANAH";
      if (scope !== "KHASANAH") continue;

      const kat = cleanStr(row.kategori);
      if (["Lainnya", "ULE Campuran", "UTLE Campuran"].includes(kat)) continue;

      const key = kat + "_" + cleanStr(String(row.pecahan));
      if (rincianSebelumnya[key] === undefined) continue;

      const tipe = row.tipe;
      const nominal = parseFloat(String(row.nominal)) || 0;
      const isBon = ["BON PAGI", "BON TAMBAHAN", "BON"].includes(tipe);
      const isSetor = ["SETOR SORE", "SETOR TAMBAHAN", "SETOR"].includes(tipe);
      const tglTrx = formatSafeString(row.tanggal);

      if (latestSnapshotDate && tglTrx >= latestSnapshotDate && tglTrx < tgl) {
        if (isBon) rincianSebelumnya[key] -= nominal;
        if (isSetor) rincianSebelumnya[key] += nominal;
      } else if (tglTrx === tgl) {
        if (isBon) pengeluaranHariIni[key] += nominal;
      }
    }

    const rincianArray: Array<Record<string, unknown>> = [];
    let totalHariSebelumnya = 0, totalPengeluaran = 0, totalCluis = 0;

    for (const k in rincianSebelumnya) {
      const p = k.split("_");
      const nomSebelumnya = rincianSebelumnya[k];
      const nomPengeluaran = pengeluaranHariIni[k];
      const nomCluis = nomSebelumnya - nomPengeluaran;

      if (nomSebelumnya > 0 || nomPengeluaran > 0 || nomCluis !== 0) {
        const pecNum = parseInt(p[1], 10);
        const isStr = isNaN(pecNum);
        const lembarSebelumnya = isStr ? (nomSebelumnya > 0 ? 1 : 0) : Math.floor(nomSebelumnya / pecNum);
        const lembarPengeluaran = isStr ? (nomPengeluaran > 0 ? 1 : 0) : Math.floor(nomPengeluaran / pecNum);
        const lembarCluis = isStr ? (nomCluis > 0 ? 1 : 0) : Math.floor(nomCluis / pecNum);

        totalHariSebelumnya += nomSebelumnya;
        totalPengeluaran += nomPengeluaran;
        totalCluis += nomCluis;

        rincianArray.push({
          kategori: p[0],
          pecahan: isStr ? p[1] : pecNum,
          lembarSebelumnya,
          nominalSebelumnya: nomSebelumnya,
          lembarPengeluaran,
          nominalPengeluaran: nomPengeluaran,
          lembarCluis,
          nominalCluis: nomCluis,
          order: catOrder[p[0]] || 99,
        });
      }
    }

    rincianArray.sort((a, b) => {
      if ((a.order as number) !== (b.order as number)) return (a.order as number) - (b.order as number);
      const pecA = parseInt(String(a.pecahan));
      const pecB = parseInt(String(b.pecahan));
      if (isNaN(pecA) && isNaN(pecB)) return String(a.pecahan).localeCompare(String(b.pecahan));
      if (isNaN(pecA)) return 1;
      if (isNaN(pecB)) return -1;
      return pecB - pecA;
    });

    return successResponse({
      rincian: rincianArray,
      totalHariSebelumnya,
      totalPengeluaran,
      totalCluis,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
