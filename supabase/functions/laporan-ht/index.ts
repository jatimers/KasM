// Edge Function: /api/laporan-ht
// Ported from: getLapSaldoKasHariIni(), getLapMutasiKhasanah(),
//   fetchDataHT(), getRekapHeadTeller(), getHistoryTransaksiHT() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit, formatSafeString } from "../_shared/utils.ts";

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
    const action = url.searchParams.get("action") ?? "saldo-kas";
    const tgl = url.searchParams.get("tanggal") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";
    const tipeLap = url.searchParams.get("tipeLap") ?? "SETOR"; // 'SETOR' or 'BON'

    if (!tgl) return errorResponse("Missing tanggal parameter");

    // getLapSaldoKasHariIni
    if (action === "saldo-kas") {
      // Get users for mapping
      const { data: users } = await supabase.from("users").select("*");
      const userMap: Record<string, string> = {};
      for (const u of (users || [])) {
        userMap[normalizeUnit(u.user_estim)] = u.nama_unit + " (" + cleanStr(u.nama_user) + ")";
      }

      // Get latest snapshot date from saldo_awal_ht
      const { data: snapshots } = await supabase
        .from("saldo_awal_ht")
        .select("*")
        .lte("tanggal", tgl);

      // Filter by wilayah
      const filteredSnapshots = (snapshots || []).filter(
        (s: Record<string, unknown>) => kodeWilayah === "ALL" || cleanStr(s.kode_wilayah as string) === kodeWilayah
      );

      // Sort by date desc
      filteredSnapshots.sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));

      let latestSnapshotDate = "";
      const rincianHT: Record<string, number> = {};

      // Initialize rincian
      for (const cat in configKeys) {
        for (const pec of configKeys[cat]) {
          rincianHT[cat + "_" + pec] = 0;
        }
      }

      if (filteredSnapshots.length > 0) {
        latestSnapshotDate = formatSafeString(filteredSnapshots[0].tanggal);
        for (const s of filteredSnapshots) {
          if (formatSafeString(s.tanggal) === latestSnapshotDate) {
            const key = cleanStr(s.kategori as string) + "_" + cleanStr(String(s.pecahan));
            rincianHT[key] = (rincianHT[key] || 0) + (parseFloat(String(s.nominal)) || 0);
          }
        }
      }

      // Get bon_setor mutations (paginated to avoid 1000-row limit)
      let bonData: any[] = [];
      let pageStart = 0;
      const pageSize = 900;
      while (true) {
        const { data: page } = await supabase
          .from("bon_setor")
          .select("*")
          .gte("tanggal", latestSnapshotDate || tgl)
          .lte("tanggal", tgl)
          .range(pageStart, pageStart + pageSize - 1)
          .order("tanggal");
        if (!page || page.length === 0) break;
        bonData = bonData.concat(page);
        if (page.length < pageSize) break;
        pageStart += pageSize;
      }

      const tellerCashboxes: Record<string, number> = {};

      for (const row of (bonData || [])) {
        const rowWilayah = cleanStr(row.kode_wilayah);
        if (kodeWilayah !== "ALL" && rowWilayah !== kodeWilayah) continue;

        const scope = row.scope || "KHASANAH";
        if (scope === "KHASANAH") {
          const tipe = row.tipe;
          const nominal = parseFloat(String(row.nominal)) || 0;
          const isBon = ["BON PAGI", "BON TAMBAHAN", "BON"].includes(tipe);
          const isSetor = ["SETOR SORE", "SETOR TAMBAHAN", "SETOR"].includes(tipe);
          const key = cleanStr(row.kategori) + "_" + cleanStr(String(row.pecahan));

          if (rincianHT[key] === undefined) rincianHT[key] = 0;
          if (isBon) rincianHT[key] -= nominal;
          if (isSetor) rincianHT[key] += nominal;
        }

        // Track teller cashboxes (SETOR SORE only)
        if (row.tipe === "SETOR SORE" && formatSafeString(row.tanggal) === tgl) {
          const uEstim = cleanStr(row.user_estim);
          const nom = parseFloat(String(row.nominal)) || 0;
          tellerCashboxes[uEstim] = (tellerCashboxes[uEstim] || 0) + nom;
        }
      }

      const tellerList: Array<{ userEstim: string; namaUnit: string; total: number }> = [];
      let totalTeller = 0;
      for (const k in tellerCashboxes) {
        totalTeller += tellerCashboxes[k];
        tellerList.push({
          userEstim: k,
          namaUnit: userMap[normalizeUnit(k)] || k,
          total: tellerCashboxes[k],
        });
      }

      let totalHT = 0;
      const rincianArray: Array<{
        kategori: string; pecahan: number | string; lembar: number;
        nominal: number; order: number;
      }> = [];

      for (const k in rincianHT) {
        const p = k.split("_");
        if (["Lainnya", "ULE Campuran", "UTLE Campuran"].includes(p[0])) continue;
        if (!catOrder[p[0]]) continue;

        const nom = rincianHT[k];
        const pecNum = parseInt(p[1], 10);
        const isStr = isNaN(pecNum);
        const lem = isStr ? (nom > 0 ? 1 : 0) : Math.floor(nom / pecNum);
        totalHT += nom;
        rincianArray.push({
          kategori: p[0],
          pecahan: isStr ? p[1] : pecNum,
          lembar: lem,
          nominal: nom,
          order: catOrder[p[0]] || 99,
        });
      }

      rincianArray.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        const pecA = parseInt(String(a.pecahan));
        const pecB = parseInt(String(b.pecahan));
        if (isNaN(pecA) && isNaN(pecB)) return String(a.pecahan).localeCompare(String(b.pecahan));
        if (isNaN(pecA)) return 1;
        if (isNaN(pecB)) return -1;
        return pecB - pecA;
      });

      return successResponse({
        htRincian: rincianArray,
        totalHT,
        tellerList,
        totalTeller,
        grandTotal: totalHT + totalTeller,
      });
    }

    // getLapMutasiKhasanah
    if (action === "mutasi") {
      const { data: users } = await supabase.from("users").select("*");
      const userMap: Record<string, string> = {};
      for (const u of (users || [])) {
        userMap[normalizeUnit(u.user_estim)] = u.nama_unit + " (" + cleanStr(u.nama_user) + ")";
      }

      const { data: bonData } = await supabase
        .from("bon_setor")
        .select("*")
        .eq("tanggal", tgl)
        .limit(100000);

      const rincian: Record<string, { kategori: string; pecahan: number | string; lembar: number; nominal: number; order: number }> = {};
      let total = 0;
      const tellerCashboxes: Record<string, number> = {};

      // Initialize
      for (const cat in configKeys) {
        for (const pec of configKeys[cat]) {
          rincian[cat + "_" + pec] = { kategori: cat, pecahan: pec, lembar: 0, nominal: 0, order: catOrder[cat] || 99 };
        }
      }

      for (const row of (bonData || [])) {
        const rowWilayah = cleanStr(row.kode_wilayah);
        if (kodeWilayah !== "ALL" && rowWilayah !== kodeWilayah) continue;

        const tipe = row.tipe;
        const isBon = ["BON PAGI", "BON TAMBAHAN", "BON"].includes(tipe);
        const isSetor = ["SETOR SORE", "SETOR TAMBAHAN", "SETOR"].includes(tipe);

        if ((tipeLap === "SETOR" && isSetor) || (tipeLap === "BON" && isBon)) {
          const scope = row.scope || "KHASANAH";
          if (scope === "KHASANAH") {
            const kat = cleanStr(row.kategori);
            if (!["Lainnya", "ULE Campuran", "UTLE Campuran"].includes(kat) && configKeys[kat]) {
              const key = kat + "_" + cleanStr(String(row.pecahan));
              const nominal = parseFloat(String(row.nominal)) || 0;
              if (rincian[key]) {
                rincian[key].nominal += nominal;
                const pecNum = parseInt(String(row.pecahan));
                rincian[key].lembar = isNaN(pecNum) ? (rincian[key].nominal > 0 ? 1 : 0) : Math.floor(rincian[key].nominal / pecNum);
                total += nominal;
              }
            }
          }
        }

        // Per teller tracking
        if (tipeLap === "SETOR") {
          if (tipe === "SETOR SORE") {
            const uEstim = cleanStr(row.user_estim);
            tellerCashboxes[uEstim] = (tellerCashboxes[uEstim] || 0) + (parseFloat(String(row.nominal)) || 0);
          }
        } else {
          if (isBon && (row.scope || "KHASANAH") === "KHASANAH") {
            const uEstim = cleanStr(row.user_estim);
            tellerCashboxes[uEstim] = (tellerCashboxes[uEstim] || 0) + (parseFloat(String(row.nominal)) || 0);
          }
        }
      }

      const rincianArr = Object.values(rincian)
        .filter(r => r.nominal > 0)
        .sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          const pecA = parseInt(String(a.pecahan));
          const pecB = parseInt(String(b.pecahan));
          if (isNaN(pecA) && isNaN(pecB)) return String(a.pecahan).localeCompare(String(b.pecahan));
          if (isNaN(pecA)) return 1;
          if (isNaN(pecB)) return -1;
          return pecB - pecA;
        });

      const tellerList: Array<{ userEstim: string; namaUnit: string; total: number }> = [];
      let totalTeller = 0;
      for (const k in tellerCashboxes) {
        totalTeller += tellerCashboxes[k];
        tellerList.push({
          userEstim: k,
          namaUnit: userMap[normalizeUnit(k)] || k,
          total: tellerCashboxes[k],
        });
      }

      return successResponse({
        rincian: rincianArr,
        total,
        tellerList,
        totalTeller,
      });
    }

    // fetchDataHT - simple history
    if (action === "history-ht") {
      const { data: bonData } = await supabase
        .from("bon_setor")
        .select("*")
        .eq("tanggal", tgl)
        .limit(100000);

      const filtered = (bonData || []).filter((row: Record<string, unknown>) => {
        if (kodeWilayah !== "ALL" && cleanStr(row.kode_wilayah as string) !== kodeWilayah) return false;
        return true;
      });

      const historyMap = new Map<string, {
        idTransaksi: string; userEstim: string; tipe: string; nominal: number; pengali: number;
      }>();

      for (const row of filtered) {
        const scope = row.scope || "KHASANAH";
        if (scope !== "KHASANAH") continue;
        const idTrx = cleanStr(row.id_transaksi as string);
        if (!historyMap.has(idTrx)) {
          historyMap.set(idTrx, {
            idTransaksi: idTrx,
            userEstim: cleanStr(row.user_estim as string),
            tipe: row.tipe as string,
            nominal: 0,
            pengali: 0,
          });
        }
      }

      return successResponse({
        saldoAwal: 0,
        bonHariIni: 0,
        setorHariIni: 0,
        saldoAkhir: 0,
        history: Array.from(historyMap.values()),
      });
    }

    return errorResponse("Invalid action", 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
