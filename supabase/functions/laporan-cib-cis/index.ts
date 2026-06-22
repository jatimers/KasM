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
    // Menggunakan laporan-ht saldo-kas (akurat, sudah teruji)
    // Hari libur/weekend → carry forward saldo hari kerja sebelumnya
    // =============================================
    if (action === "cis") {
      const SB_URL = Deno.env.get("SB_URL") ?? "";
      const SB_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

      // Fetch hari_libur
      const { data: liburData } = await supabase.from("hari_libur").select("tanggal");
      const liburSet = new Set<string>();
      for (const row of (liburData || [])) {
        const tgl = String(row.tanggal).substring(0, 10);
        if (tgl && tgl !== "-") liburSet.add(tgl);
      }

      // Fetch grandTotal from laporan-ht for each day (parallel batch 5, with warm-up)
      const rawSaldo: Record<string, number> = {};

      // Warm-up: call first date solo to handle cold start
      if (allDates.length > 0) {
        const warmTgl = allDates[0];
        try {
          const warmUrl = `${SB_URL}/functions/v1/laporan-ht?action=saldo-kas&tanggal=${warmTgl}&kodeWilayah=${kodeWilayah}`;
          const warmResp = await fetch(warmUrl, { headers: { Authorization: `Bearer ${SB_KEY}` } });
          if (warmResp.ok) {
            const warmJson = await warmResp.json();
            rawSaldo[warmTgl] = warmJson?.data?.grandTotal ?? 0;
          }
        } catch (_) { rawSaldo[warmTgl] = 0; }
      }

      // Batch the rest in parallel (skip first date)
      const BATCH = 5;
      const rest = allDates.slice(1);
      for (let i = 0; i < rest.length; i += BATCH) {
        const batch = rest.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (tgl) => {
          try {
            const laporUrl = `${SB_URL}/functions/v1/laporan-ht?action=saldo-kas&tanggal=${tgl}&kodeWilayah=${kodeWilayah}`;
            const resp = await fetch(laporUrl, { headers: { Authorization: `Bearer ${SB_KEY}` } });
            if (resp.ok) {
              const json = await resp.json();
              return { tgl, gt: json?.data?.grandTotal ?? 0 };
            }
          } catch (_) { /* fall through */ }
          return { tgl, gt: 0 };
        }));
        for (const { tgl, gt } of results) {
          rawSaldo[tgl] = gt;
        }
      }

      // Post-process: carry forward for weekends and holidays only
      const saldoPerTanggal: Record<string, number> = {};
      let lastWorkingDaySaldo = 0;
      let grandTotal = 0;

      // Pre-scan: find first working day with non-zero saldo to handle cold-start failures
      for (const tgl of allDates) {
        const p = tgl.split("-").map(Number);
        const d = new Date(p[0], p[1] - 1, p[2]);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const isLibur = liburSet.has(tgl);
        if (!isWeekend && !isLibur && (rawSaldo[tgl] || 0) > 0) {
          lastWorkingDaySaldo = rawSaldo[tgl];
          break;
        }
      }

      for (const tgl of allDates) {
        const p = tgl.split("-").map(Number);
        const d = new Date(p[0], p[1] - 1, p[2]);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const isLibur = liburSet.has(tgl);

        if (isWeekend || isLibur) {
          saldoPerTanggal[tgl] = lastWorkingDaySaldo;
        } else {
          // Use laporan-ht value; if 0, keep last known good saldo
          const val = rawSaldo[tgl] || 0;
          if (val > 0) {
            lastWorkingDaySaldo = val;
          }
          saldoPerTanggal[tgl] = lastWorkingDaySaldo;
        }
        grandTotal += saldoPerTanggal[tgl];
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
