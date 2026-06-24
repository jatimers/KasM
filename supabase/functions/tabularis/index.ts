// Edge Function: /api/tabularis
// Ported from: getTabularisData() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";

const pKertas = ["100000", "75000", "50000", "20000", "10000", "5000", "2000", "1000"];
const pLogam = ["1000", "500", "200", "100"];

interface BlankSchema {
  kertas: Record<string, number>;
  logam: Record<string, number>;
  utle: number;
  teller: Record<string, number>;
  kf: Record<string, number>;
}

function createBlankSchema(listTeller: string[], listKF: string[]): BlankSchema {
  const obj: BlankSchema = { kertas: {}, logam: {}, utle: 0, teller: {}, kf: {} };
  for (const p of pKertas) obj.kertas[p] = 0;
  for (const p of pLogam) obj.logam[p] = 0;
  for (const t of listTeller) obj.teller[t] = 0;
  for (const k of listKF) obj.kf[k] = 0;
  return obj;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const periode = url.searchParams.get("periode") ?? ""; // Format: YYYY-MM

    if (!periode) return errorResponse("Missing periode parameter (YYYY-MM)");

    // Get users
    const { data: users } = await supabase.from("users").select("*").limit(100000);
    const listTeller: string[] = [];
    const listKF: string[] = [];
    const userMap: Record<string, string> = {};
    const kfUnitMap: Record<string, string> = {};

    for (const u of (users || [])) {
      const role = String(u.role).toLowerCase().trim();
      const uEstim = String(u.user_estim).trim();
      const uName = String(u.nama_user).trim();
      const namaUnit = String(u.nama_unit).trim();
      const displayName = uName || uEstim;

      if (uEstim) {
        userMap[uEstim] = displayName;
        if ((role === "teller" || role === "pp") && !listTeller.includes(displayName)) listTeller.push(displayName);
        else if (role === "kf" && !listKF.includes(displayName)) {
          listKF.push(displayName);
          kfUnitMap[displayName] = namaUnit;
        }
      }
    }

    // Running saldo init from saldo_awal_ht
    const runningSaldo = createBlankSchema(listTeller, listKF);

    const { data: htData } = await supabase.from("saldo_awal_ht").select("*").limit(100000);
    for (const row of (htData || [])) {
      const jenisUang = String(row.kategori).toUpperCase().trim();
      const pcn = String(row.pecahan).trim();
      const nom = Number(row.nominal) || 0;

      if (pKertas.includes(pcn) && (jenisUang.includes("ULE") || jenisUang.includes("HCS"))) {
        runningSaldo.kertas[pcn] += nom;
      }
      if (pLogam.includes(pcn) && jenisUang.includes("LOGAM")) {
        runningSaldo.logam[pcn] += nom;
      }
      if (jenisUang.includes("UTLE")) {
        runningSaldo.utle += nom;
      }
    }

    // Get all bon_setor (paginated to bypass 1000-row limit)
    let bonData: any[] = [];
    let pageStart = 0;
    const pageSize = 900;
    while (true) {
      const { data: page } = await supabase
        .from("bon_setor")
        .select("*")
        .range(pageStart, pageStart + pageSize - 1)
        .order("tanggal");
      if (!page || page.length === 0) break;
      bonData = bonData.concat(page);
      if (page.length < pageSize) break;
      pageStart += pageSize;
    }

    // Process pre-period mutations
    const currentMonthTrans: Array<Record<string, unknown>> = [];
    const setTanggal = new Set<string>();

    for (const row of (bonData || [])) {
      const tglStr = String(row.tanggal).substring(0, 10);
      if (!tglStr) continue;

      const uEstim = String(row.user_estim).trim();
      const userTrans = userMap[uEstim] || uEstim;

      const jenisRaw = String(row.tipe).toUpperCase().trim();
      const kategori = String(row.kategori).toUpperCase().trim();
      const pecahan = String(row.pecahan).trim();
      const nominal = Number(row.nominal) || 0;
      const scopeRaw = row.scope ? String(row.scope).toUpperCase().trim() : "";

      const isKertasValid = kategori.includes("ULE") || kategori.includes("HCS");
      const isLogamValid = kategori.includes("LOGAM");
      const isUtleValid = kategori.includes("UTLE");

      if (tglStr.startsWith(periode)) {
        setTanggal.add(tglStr);
        currentMonthTrans.push({
          tglStr, userTrans, jenisRaw, kategori, scopeRaw,
          nominal, pecahan, isKertasValid, isLogamValid, isUtleValid,
        });
      } else if (tglStr < periode + "-01") {
        if (jenisRaw === "BON TAMBAHAN" && scopeRaw === "KHASANAH") {
          if (pKertas.includes(pecahan) && isKertasValid) runningSaldo.kertas[pecahan] -= nominal;
          if (pLogam.includes(pecahan) && isLogamValid) runningSaldo.logam[pecahan] -= nominal;
          if (isUtleValid) runningSaldo.utle -= nominal;
        } else if (jenisRaw === "SETOR TAMBAHAN" && scopeRaw === "KHASANAH") {
          if (pKertas.includes(pecahan) && isKertasValid) runningSaldo.kertas[pecahan] += nominal;
          if (pLogam.includes(pecahan) && isLogamValid) runningSaldo.logam[pecahan] += nominal;
          if (isUtleValid) runningSaldo.utle += nominal;
        }

        if (jenisRaw === "BON PAGI" && scopeRaw === "HEAD TELLER") {
          if (listTeller.includes(userTrans)) runningSaldo.teller[userTrans] -= nominal;
          if (listKF.includes(userTrans)) runningSaldo.kf[userTrans] -= nominal;
        } else if (jenisRaw === "SETOR SORE" && scopeRaw === "HEAD TELLER") {
          if (listTeller.includes(userTrans)) runningSaldo.teller[userTrans] += nominal;
          if (listKF.includes(userTrans)) runningSaldo.kf[userTrans] += nominal;
        }
      }
    }

    // Build daily data
    const listTanggalEfektif = Array.from(setTanggal).sort();
    const resultRows: Array<Record<string, unknown>> = [];

    for (const tgl of listTanggalEfektif) {
      const dailyData: Record<string, BlankSchema> = {
        "SALDO AWAL": createBlankSchema(listTeller, listKF),
        "BON": createBlankSchema(listTeller, listKF),
        "SISA": createBlankSchema(listTeller, listKF),
        "SETORAN": createBlankSchema(listTeller, listKF),
        "SALDO AKHIR": createBlankSchema(listTeller, listKF),
      };

      // Copy running saldo to SALDO AWAL
      for (const p of pKertas) dailyData["SALDO AWAL"].kertas[p] = runningSaldo.kertas[p];
      for (const p of pLogam) dailyData["SALDO AWAL"].logam[p] = runningSaldo.logam[p];
      dailyData["SALDO AWAL"].utle = runningSaldo.utle;
      for (const t of listTeller) dailyData["SALDO AWAL"].teller[t] = runningSaldo.teller[t];
      for (const k of listKF) dailyData["SALDO AWAL"].kf[k] = runningSaldo.kf[k];

      // Process daily mutations
      for (const tr of currentMonthTrans) {
        if (tr.tglStr !== tgl) continue;

        if (tr.jenisRaw === "BON TAMBAHAN" && tr.scopeRaw === "KHASANAH") {
          if (pKertas.includes(tr.pecahan as string) && tr.isKertasValid) dailyData["BON"].kertas[tr.pecahan as string] += tr.nominal as number;
          if (pLogam.includes(tr.pecahan as string) && tr.isLogamValid) dailyData["BON"].logam[tr.pecahan as string] += tr.nominal as number;
          if (tr.isUtleValid) dailyData["BON"].utle += tr.nominal as number;
        } else if (tr.jenisRaw === "SETOR TAMBAHAN" && tr.scopeRaw === "KHASANAH") {
          if (pKertas.includes(tr.pecahan as string) && tr.isKertasValid) dailyData["SETORAN"].kertas[tr.pecahan as string] += tr.nominal as number;
          if (pLogam.includes(tr.pecahan as string) && tr.isLogamValid) dailyData["SETORAN"].logam[tr.pecahan as string] += tr.nominal as number;
          if (tr.isUtleValid) dailyData["SETORAN"].utle += tr.nominal as number;
        }

        if (tr.jenisRaw === "BON PAGI" && tr.scopeRaw === "HEAD TELLER") {
          if (listTeller.includes(tr.userTrans as string)) dailyData["BON"].teller[tr.userTrans as string] += tr.nominal as number;
          if (listKF.includes(tr.userTrans as string)) dailyData["BON"].kf[tr.userTrans as string] += tr.nominal as number;
        } else if (tr.jenisRaw === "SETOR SORE" && tr.scopeRaw === "HEAD TELLER") {
          if (listTeller.includes(tr.userTrans as string)) dailyData["SETORAN"].teller[tr.userTrans as string] += tr.nominal as number;
          if (listKF.includes(tr.userTrans as string)) dailyData["SETORAN"].kf[tr.userTrans as string] += tr.nominal as number;
        }
      }

      // Calculate SISA and SALDO AKHIR, update running saldo
      for (const p of pKertas) {
        dailyData["SISA"].kertas[p] = dailyData["SALDO AWAL"].kertas[p] - dailyData["BON"].kertas[p];
        dailyData["SALDO AKHIR"].kertas[p] = dailyData["SISA"].kertas[p] + dailyData["SETORAN"].kertas[p];
        runningSaldo.kertas[p] = dailyData["SALDO AKHIR"].kertas[p];
      }
      for (const p of pLogam) {
        dailyData["SISA"].logam[p] = dailyData["SALDO AWAL"].logam[p] - dailyData["BON"].logam[p];
        dailyData["SALDO AKHIR"].logam[p] = dailyData["SISA"].logam[p] + dailyData["SETORAN"].logam[p];
        runningSaldo.logam[p] = dailyData["SALDO AKHIR"].logam[p];
      }
      dailyData["SISA"].utle = dailyData["SALDO AWAL"].utle - dailyData["BON"].utle;
      dailyData["SALDO AKHIR"].utle = dailyData["SISA"].utle + dailyData["SETORAN"].utle;
      runningSaldo.utle = dailyData["SALDO AKHIR"].utle;

      for (const t of listTeller) {
        dailyData["SISA"].teller[t] = dailyData["SALDO AWAL"].teller[t] - dailyData["BON"].teller[t];
        dailyData["SALDO AKHIR"].teller[t] = dailyData["SISA"].teller[t] + dailyData["SETORAN"].teller[t];
        runningSaldo.teller[t] = dailyData["SALDO AKHIR"].teller[t];
      }
      for (const k of listKF) {
        dailyData["SISA"].kf[k] = dailyData["SALDO AWAL"].kf[k] - dailyData["BON"].kf[k];
        dailyData["SALDO AKHIR"].kf[k] = dailyData["SISA"].kf[k] + dailyData["SETORAN"].kf[k];
        runningSaldo.kf[k] = dailyData["SALDO AKHIR"].kf[k];
      }

      resultRows.push({ tanggal: tgl, ...dailyData });
    }

    return successResponse({
      listTeller,
      listKF,
      kfUnitMap,
      rows: resultRows,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
