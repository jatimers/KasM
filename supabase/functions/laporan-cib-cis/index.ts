// Edge Function: /api/laporan-cib-cis
// Laporan CIB (Bon Pagi per KF) dan CIS (Saldo Khasanah harian)
// Akses: headteller, pbo

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient, fetchAll } from "../_shared/supabase.ts";
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
      // Get KF and Teller users
      let kfQuery = supabase
        .from("users")
        .select("user_estim, nama_unit, role")
        .in("role", ["kf", "teller"])
        .order("user_estim");
      kfQuery = filterWilayah(kfQuery, "kode_wilayah");
      const { data: kfUsers } = await kfQuery;

      const kfList = (kfUsers || []).map(u => ({
        userEstim: cleanStr(u.user_estim),
        namaUnit: u.nama_unit || cleanStr(u.user_estim),
        role: u.role || "",
      }));

      // Sort: Teller first (IP04, IP09, IP10), then KF (Senduro, Pemkab, Klakah, Jatiroto)
      const tellerOrder = ["JTM009IP04", "JTM009IP09", "JTM009IP10"];
      const kfOrder = ["JTM009IP07", "JTM009IP06", "JTM009IP02", "JTM009IP05"];
      kfList.sort((a, b) => {
        const roleOrder = a.role === "teller" ? 0 : 1;
        const roleOrderB = b.role === "teller" ? 0 : 1;
        if (roleOrder !== roleOrderB) return roleOrder - roleOrderB;
        const orderArr = a.role === "teller" ? tellerOrder : kfOrder;
        const idxA = orderArr.indexOf(a.userEstim);
        const idxB = orderArr.indexOf(b.userEstim);
        if (idxA === -1 && idxB === -1) return a.userEstim.localeCompare(b.userEstim);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });

      // Helper: build query with wilayah filter
      function baseQuery() {
        let q = supabase
          .from("bon_setor")
          .select("tanggal, user_estim, tipe, nominal")
          .gte("tanggal", startDate)
          .lte("tanggal", endDate);
        if (kodeWilayah !== "ALL") q = q.eq("kode_wilayah", kodeWilayah);
        return q;
      }

      // Get BON PAGI
      const { data: bonPagiData } = await baseQuery().eq("tipe", "BON PAGI");

      // Get BON TAMBAHAN (hanya untuk teller)
      const { data: bonTambahanData } = await baseQuery().eq("tipe", "BON TAMBAHAN");

      // Build matrix: tanggal → userEstim → total
      const matrix: Record<string, Record<string, number>> = {};
      for (const tgl of allDates) {
        matrix[tgl] = {};
        for (const kf of kfList) {
          matrix[tgl][kf.userEstim] = 0;
        }
      }

      // Add BON PAGI for all users
      for (const row of (bonPagiData || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        const ue = cleanStr(row.user_estim);
        const nominal = parseFloat(String(row.nominal)) || 0;
        if (matrix[tgl] && matrix[tgl][ue] !== undefined) {
          matrix[tgl][ue] += nominal;
        }
      }

      // Add BON TAMBAHAN for teller users only
      for (const row of (bonTambahanData || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        const ue = cleanStr(row.user_estim);
        const nominal = parseFloat(String(row.nominal)) || 0;
        if (matrix[tgl] && matrix[tgl][ue] !== undefined) {
          // Cek apakah user ini teller
          const user = kfList.find(u => u.userEstim === ue);
          if (user && user.role === "teller") {
            matrix[tgl][ue] += nominal;
          }
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
    // CIS: Saldo Akhir Hari Khasanah (Head Teller)
    // Formula: saldo_awal_ht + KHASANAH NET + SETOR SORE (all scopes)
    // Menggunakan fetchAll untuk pagination
    // Hari libur/weekend → carry forward saldo hari kerja sebelumnya
    // =============================================
    if (action === "cis") {
      // Fetch hari_libur
      const { data: liburData } = await supabase.from("hari_libur").select("tanggal");
      const liburSet = new Set<string>();
      for (const row of (liburData || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        if (tgl && tgl !== "-") liburSet.add(tgl);
      }

      // Step 1: Find latest snapshot date and total
      let saldoQuery = supabase
        .from("saldo_awal_ht")
        .select("tanggal, nominal")
        .lte("tanggal", endDate)
        .order("tanggal", { ascending: false });
      saldoQuery = filterWilayah(saldoQuery, "kode_wilayah");
      const allSaldo = await fetchAll(saldoQuery);

      let snapshotDate = "";
      let initialSaldo = 0;
      if (allSaldo.length > 0) {
        snapshotDate = String(allSaldo[0].tanggal).substring(0, 10);
        for (const s of allSaldo) {
          if (String(s.tanggal).substring(0, 10) === snapshotDate) {
            initialSaldo += parseFloat(String(s.nominal)) || 0;
          }
        }
      }

      // Step 2: Get ALL bon_setor from snapshotDate to endDate
      const queryFrom = snapshotDate || startDate;
      let mutQuery = supabase
        .from("bon_setor")
        .select("tanggal, tipe, nominal, scope")
        .gte("tanggal", queryFrom)
        .lte("tanggal", endDate)
        .order("tanggal");
      if (kodeWilayah !== "ALL") {
        mutQuery = mutQuery.eq("kode_wilayah", kodeWilayah);
      }
      const allBonSetor = await fetchAll(mutQuery);

      // Step 3: Compute daily net change
      // Net(t) = +KHASANAH SETOR - KHASANAH BON + ALL SETOR SORE
      const netByDate: Record<string, number> = {};
      for (const row of allBonSetor) {
        const tgl = String(row.tanggal).substring(0, 10);
        const nom = parseFloat(String(row.nominal)) || 0;
        const tipe = row.tipe;
        const scope = row.scope || "KHASANAH";

        if (tipe === "SETOR SORE") {
          // ALL scopes SETOR SORE adds to daily balance
          netByDate[tgl] = (netByDate[tgl] || 0) + nom;
        } else if (scope === "KHASANAH") {
          if (["SETOR TAMBAHAN", "SETOR"].includes(tipe)) {
            netByDate[tgl] = (netByDate[tgl] || 0) + nom;
          } else if (["BON PAGI", "BON TAMBAHAN", "BON"].includes(tipe)) {
            netByDate[tgl] = (netByDate[tgl] || 0) - nom;
          }
        }
      }

      // Step 4: Generate daily balances from snapshot to endDate
      const allDatesFromSnapshot: string[] = [];
      const parts0 = queryFrom.split("-").map(Number);
      const cursor = new Date(parts0[0], parts0[1] - 1, parts0[2]);
      const edParts = endDate.split("-").map(Number);
      const ed = new Date(edParts[0], edParts[1] - 1, edParts[2]);
      while (cursor <= ed) {
        allDatesFromSnapshot.push(
          cursor.getFullYear() + "-" +
          String(cursor.getMonth() + 1).padStart(2, "0") + "-" +
          String(cursor.getDate()).padStart(2, "0")
        );
        cursor.setDate(cursor.getDate() + 1);
      }

      const dailyBalance: Record<string, number> = {};
      let running = initialSaldo;
      for (const tgl of allDatesFromSnapshot) {
        running += netByDate[tgl] || 0;
        dailyBalance[tgl] = running;
      }

      // Step 5: Extract target month + carry forward weekends/holidays
      const saldoPerTanggal: Record<string, number> = {};
      let lastWorkingDaySaldo = 0;
      let grandTotal = 0;

      // Find first valid working day saldo for back-fill
      for (const tgl of allDates) {
        const p = tgl.split("-").map(Number);
        const d = new Date(p[0], p[1] - 1, p[2]);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const isLibur = liburSet.has(tgl);
        if (!isWeekend && !isLibur && (dailyBalance[tgl] || 0) > 0) {
          lastWorkingDaySaldo = dailyBalance[tgl];
          break;
        }
      }

      for (const tgl of allDates) {
        let saldo = dailyBalance[tgl] || 0;
        const p = tgl.split("-").map(Number);
        const d = new Date(p[0], p[1] - 1, p[2]);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const isLibur = liburSet.has(tgl);

        if (isWeekend || isLibur) {
          saldo = lastWorkingDaySaldo;
        } else {
          if (saldo === 0 && lastWorkingDaySaldo > 0) {
            saldo = lastWorkingDaySaldo;
          }
          lastWorkingDaySaldo = saldo;
        }
        saldoPerTanggal[tgl] = saldo;
        grandTotal += saldo;
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
