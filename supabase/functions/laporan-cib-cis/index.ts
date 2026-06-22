// Edge Function: /api/laporan-cib-cis
// Laporan CIB (Bon Pagi per KF) dan CIS (Saldo Khasanah harian)
// Akses: headteller, pbo

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
    const action = url.searchParams.get("action") ?? "cib";
    const bulan = url.searchParams.get("bulan") ?? ""; // YYYY-MM
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";

    if (!bulan) return errorResponse("Missing bulan parameter (YYYY-MM)");

    const [tahunStr, bulanStr] = bulan.split("-");
    const tahun = parseInt(tahunStr);
    const blnIdx = parseInt(bulanStr) - 1;
    const firstDay = new Date(tahun, blnIdx, 1);
    const lastDay = new Date(tahun, blnIdx + 1, 0);
    const startDate = `${tahunStr}-${bulanStr}-01`;
    const endDate = `${tahunStr}-${bulanStr}-${String(lastDay.getDate()).padStart(2, "0")}`;

    // Generate all dates in the month
    const allDates: string[] = [];
    const d = new Date(firstDay);
    while (d <= lastDay) {
      allDates.push(d.toISOString().split("T")[0]);
      d.setDate(d.getDate() + 1);
    }

    // Helper: apply wilayah filter if not ALL
    function filterWilayah(q: any, col: string) {
      if (kodeWilayah !== "ALL") return q.eq(col, kodeWilayah);
      return q;
    }

    // =============================================
    // CIB: Bon Pagi per KF per tanggal
    // =============================================
    if (action === "cib") {
      // Get KF users
      let kfQuery = supabase
        .from("users")
        .select("user_estim, nama_unit")
        .eq("role", "kf")
        .order("user_estim");
      kfQuery = filterWilayah(kfQuery, "kode_wilayah");
      const { data: kfUsers } = await kfQuery;

      const kfList = (kfUsers || []).map(u => ({
        userEstim: cleanStr(u.user_estim),
        namaUnit: u.nama_unit || cleanStr(u.user_estim),
      }));

      // Get BON PAGI for the month (KF users do bon pagi with scope='HEAD TELLER')
      let query = supabase
        .from("bon_setor")
        .select("tanggal, user_estim, nominal")
        .eq("tipe", "BON PAGI")
        .gte("tanggal", startDate)
        .lte("tanggal", endDate);

      if (kodeWilayah !== "ALL") {
        query = query.eq("kode_wilayah", kodeWilayah);
      }

      const { data: bonData } = await query;

      // Build matrix: tanggal → userEstim → total
      const matrix: Record<string, Record<string, number>> = {};
      for (const tgl of allDates) {
        matrix[tgl] = {};
        for (const kf of kfList) {
          matrix[tgl][kf.userEstim] = 0;
        }
      }

      for (const row of (bonData || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        const ue = cleanStr(row.user_estim);
        const nominal = parseFloat(String(row.nominal)) || 0;
        if (matrix[tgl] && matrix[tgl][ue] !== undefined) {
          matrix[tgl][ue] += nominal;
        }
      }

      // Grand total
      let grandTotal = 0;
      for (const tgl of allDates) {
        for (const kf of kfList) {
          grandTotal += matrix[tgl][kf.userEstim];
        }
      }

      return successResponse({
        bulan,
        allDates,
        kfList,
        matrix,
        grandTotal,
      });
    }

    // =============================================
    // CIS: Saldo Khasanah harian
    // =============================================
    if (action === "cis") {
      // Step 1: Get initial saldo from saldo_awal_ht (latest before month start)
      let saldoQuery = supabase
        .from("saldo_awal_ht")
        .select("tanggal, nominal")
        .lt("tanggal", startDate)
        .order("tanggal", { ascending: false });
      saldoQuery = filterWilayah(saldoQuery, "kode_wilayah");

      const { data: saldoBefore } = await saldoQuery;

      let runningSaldo = 0;
      if (saldoBefore && saldoBefore.length > 0) {
        // Sum all nominal at the latest snapshot date before month
        const latestDate = saldoBefore[0].tanggal;
        for (const row of saldoBefore) {
          if (row.tanggal === latestDate) {
            runningSaldo += parseFloat(String(row.nominal)) || 0;
          }
        }
      }

      // Step 2: Get all KHASANAH-scope mutations for the month + teller SETOR SORE
      let mutQuery = supabase
        .from("bon_setor")
        .select("tanggal, tipe, nominal, scope")
        .gte("tanggal", startDate)
        .lte("tanggal", endDate);

      if (kodeWilayah !== "ALL") {
        mutQuery = mutQuery.eq("kode_wilayah", kodeWilayah);
      }

      const { data: mutData } = await mutQuery;

      // Step 3: Also get saldo_awal_ht within the month (new initial balances)
      let saldoInMonthQuery = supabase
        .from("saldo_awal_ht")
        .select("tanggal, nominal")
        .gte("tanggal", startDate)
        .lte("tanggal", endDate)
        .order("tanggal");
      saldoInMonthQuery = filterWilayah(saldoInMonthQuery, "kode_wilayah");
      const { data: saldoInMonth } = await saldoInMonthQuery;

      // Step 4: Compute daily balance
      // Formula: SaldoKhasanah(t) = SaldoKhasanah(t-1) + SetorSore(all scopes) + SetorTambahan(KHASANAH scope)
      // Group additions by date
      const addByDate: Record<string, number> = {};
      for (const row of (mutData || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        const nom = parseFloat(String(row.nominal)) || 0;
        const tipe = row.tipe;
        const scope = row.scope || "KHASANAH";

        // SETOR SORE: any scope (teller, kf, khasanah)
        // SETOR TAMBAHAN: KHASANAH scope only
        if (tipe === "SETOR SORE") {
          addByDate[tgl] = (addByDate[tgl] || 0) + nom;
        } else if (["SETOR TAMBAHAN", "SETOR"].includes(tipe) && scope === "KHASANAH") {
          addByDate[tgl] = (addByDate[tgl] || 0) + nom;
        }
      }

      // Also collect saldo_awal_ht changes within the month (reset points)
      const saldoResetByDate: Record<string, number> = {};
      for (const row of (saldoInMonth || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        if (!saldoResetByDate[tgl]) saldoResetByDate[tgl] = 0;
        saldoResetByDate[tgl] += parseFloat(String(row.nominal)) || 0;
      }

      // Build daily balance
      const saldoPerTanggal: Record<string, number> = {};
      let prevSaldo = runningSaldo;
      let grandTotal = 0;

      for (const tgl of allDates) {
        // If there's a new saldo_awal_ht for this date, reset from that
        if (saldoResetByDate[tgl] !== undefined) {
          runningSaldo = saldoResetByDate[tgl];
        }

        // Add SETOR SORE + SETOR TAMBAHAN for this date
        runningSaldo += addByDate[tgl] || 0;

        saldoPerTanggal[tgl] = runningSaldo;
        grandTotal += runningSaldo;
      }

      return successResponse({
        bulan,
        allDates,
        saldoPerTanggal,
        grandTotal,
      });
    }

    return errorResponse("Invalid action: " + action, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
