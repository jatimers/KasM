// Edge Function: /api/posisi-kas
// Ported from: savePosisiKas(), getHistoryPosisiKas(),
//   getViewPosisiTeller(), getRekapPosisiHarianGlobal() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit, formatSafeString } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const userEstim = url.searchParams.get("userEstim") ?? "";
    const tgl = url.searchParams.get("tanggal") ?? "";
    const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";
    const bulanTahun = url.searchParams.get("bulanTahun") ?? "";

    // GET
    if (req.method === "GET") {
      // getHistoryPosisiKas
      if (action === "history") {
        const { data, error } = await supabase
          .from("posisi_kas")
          .select("*")
          .eq("user_estim", userEstim)
          .order("tanggal", { ascending: false });

        if (error) throw error;

        const result = [];
        for (const row of (data || [])) {
          const dTgl = formatSafeString(row.tanggal);
          if (bulanTahun && !dTgl.startsWith(bulanTahun)) continue;

          result.push({
            tanggal: dTgl,
            saldoKemarin: parseFloat(String(row.saldo_kemarin)) || 0,
            penerimaanTotal: (parseFloat(String(row.penerimaan_debet)) || 0) + (parseFloat(String(row.penerimaan_antar_teller)) || 0),
            pembayaranTotal: (parseFloat(String(row.pembayaran_kredit)) || 0) + (parseFloat(String(row.pembayaran_antar_teller)) || 0),
            saldoHariIni: parseFloat(String(row.saldo_hari_ini)) || 0,
            saldoFisik: parseFloat(String(row.saldo_fisik)) || 0,
            selisih: parseFloat(String(row.selisih)) || 0,
            selisihPembulatan: parseFloat(String(row.selisih_pembulatan)) || 0,
            estimDebet: parseFloat(String(row.estim_debet)) || 0,
            estimKredit: parseFloat(String(row.estim_kredit)) || 0,
          });
        }

        return successResponse(result);
      }

      // getViewPosisiTeller
      if (action === "view-posisi") {
        const { data: users } = await supabase.from("users").select("*");
        const userMap: Record<string, { namaUnit: string; kodeCabang: string }> = {};
        for (const u of (users || [])) {
          userMap[normalizeUnit(u.user_estim)] = {
            namaUnit: u.nama_unit,
            kodeCabang: cleanStr(u.kode_cabang),
          };
        }

        let query = supabase.from("posisi_kas").select("*").eq("tanggal", tgl);
        if (kodeWilayah !== "ALL") {
          query = query.eq("kode_wilayah", kodeWilayah);
        }

        const { data: posData, error } = await query;
        if (error) throw error;

        const result = [];
        for (const row of (posData || [])) {
          const originalUe = cleanStr(row.user_estim);
          const unitInfo = userMap[normalizeUnit(originalUe)] || { namaUnit: "UNKNOWN", kodeCabang: "UNKNOWN" };
          result.push({
            userEstim: originalUe,
            namaUnit: unitInfo.namaUnit,
            kodeCabang: unitInfo.kodeCabang,
            saldoHariIni: parseFloat(String(row.saldo_hari_ini)) || 0,
            saldoFisik: parseFloat(String(row.saldo_fisik)) || 0,
            selisih: parseFloat(String(row.selisih)) || 0,
          });
        }

        return successResponse(result);
      }

      // getRekapPosisiHarianGlobal
      if (action === "rekap-harian-global") {
        // Helper: paginated fetch
        async function fetchAll(queryBuilder: any): Promise<any[]> {
          let all: any[] = [], start = 0, size = 900;
          while (true) {
            const { data, error } = await queryBuilder.range(start, start + size - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            all = all.concat(data);
            if (data.length < size) break;
            start += size;
          }
          return all;
        }

        // Find previous working day with data
        let prevDate = "";
        const allPos = await fetchAll(
          supabase.from("posisi_kas").select("tanggal, kode_wilayah").lt("tanggal", tgl).order("tanggal", { ascending: false })
        );
        for (const row of allPos) {
          if (kodeWilayah === "ALL" || cleanStr(row.kode_wilayah) === kodeWilayah) {
            if (row.tanggal > prevDate) prevDate = row.tanggal;
          }
        }

        // Also check saldo_awal_ht for dates
        const htData = await fetchAll(
          supabase.from("saldo_awal_ht").select("tanggal, kode_wilayah").lt("tanggal", tgl).order("tanggal", { ascending: false })
        );
        for (const row of htData) {
          if (kodeWilayah === "ALL" || cleanStr(row.kode_wilayah) === kodeWilayah) {
            if (row.tanggal > prevDate) prevDate = row.tanggal;
          }
        }

        const rekap = {
          saldoKemarin: 0, penerimaanDebet: 0, penerimaanAntar: 0,
          pembayaranKredit: 0, pembayaranAntar: 0, saldoHariIni: 0,
          saldoFisik: 0, selisih: 0, userTerdata: 0,
        };

        // Get saldoKemarin from previous working day: query laporan-ht for grandTotal
        if (prevDate) {
          try {
            const laporRes = await fetch(
              `${Deno.env.get("SB_URL")}/functions/v1/laporan-ht?action=saldo-kas&tanggal=${prevDate}&kodeWilayah=${kodeWilayah}`,
              { headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` } }
            );
            const laporJson = await laporRes.json();
            if (laporJson?.success) {
              rekap.saldoKemarin = laporJson.data?.grandTotal || 0;
            }
          } catch (_) { /* fallback: use simplified calculation below */ }
          // Fallback: sum saldo_hari_ini from posisi_kas
          if (rekap.saldoKemarin === 0) {
            let prevQuery = supabase.from("posisi_kas").select("saldo_hari_ini").eq("tanggal", prevDate);
            if (kodeWilayah !== "ALL") prevQuery = prevQuery.eq("kode_wilayah", kodeWilayah);
            const prevPos = await fetchAll(prevQuery);
            for (const row of prevPos) {
              rekap.saldoKemarin += parseFloat(String(row.saldo_hari_ini)) || 0;
            }
          }
        }

        // Current day mutations (paginated)
        let query = supabase.from("posisi_kas").select("*").eq("tanggal", tgl);
        if (kodeWilayah !== "ALL") query = query.eq("kode_wilayah", kodeWilayah);

        const currPos = await fetchAll(query);
        for (const row of currPos) {
          rekap.penerimaanDebet += parseFloat(String(row.penerimaan_debet)) || 0;
          rekap.penerimaanAntar += parseFloat(String(row.penerimaan_antar_teller)) || 0;
          rekap.pembayaranKredit += parseFloat(String(row.pembayaran_kredit)) || 0;
          rekap.pembayaranAntar += parseFloat(String(row.pembayaran_antar_teller)) || 0;
          rekap.userTerdata++;
        }

        rekap.saldoHariIni = rekap.saldoKemarin + rekap.penerimaanDebet + rekap.penerimaanAntar - rekap.pembayaranKredit - rekap.pembayaranAntar;

        // Compute saldoFisik = call laporan-ht to get grandTotal (vault + teller cashboxes)
        try {
          const laporRes = await fetch(
            `${Deno.env.get("SB_URL")}/functions/v1/laporan-ht?action=saldo-kas&tanggal=${tgl}&kodeWilayah=${kodeWilayah}`,
            { headers: { Authorization: `Bearer ${Deno.env.get("SB_SERVICE_ROLE_KEY")}` } }
          );
          const laporJson = await laporRes.json();
          if (laporJson?.success) {
            rekap.saldoFisik = laporJson.data?.grandTotal || 0;
          }
        } catch (_) {
          // Fallback: sum SETOR SORE only
          let fisikQuery = supabase.from("bon_setor").select("nominal").eq("tanggal", tgl).eq("tipe", "SETOR SORE");
          if (kodeWilayah !== "ALL") fisikQuery = fisikQuery.eq("kode_wilayah", kodeWilayah);
          const setorSoreData = await fetchAll(fisikQuery);
          for (const row of setorSoreData) {
            rekap.saldoFisik += parseFloat(String(row.nominal)) || 0;
          }
        }

        rekap.selisih = rekap.saldoFisik - rekap.saldoHariIni;

        return successResponse(rekap);
      }

      // Default: simple query
      const { data, error } = await supabase
        .from("posisi_kas")
        .select("*")
        .eq("tanggal", tgl)
        .eq("user_estim", userEstim)
        .maybeSingle();

      if (error) throw error;
      return successResponse(data || null);
    }

    // POST - Save posisi kas
    if (req.method === "POST") {
      const dataObj = await req.json();

      const record = {
        tanggal: dataObj.Tanggal || dataObj.tanggal,
        user_estim: dataObj.UserEstim || dataObj.userEstim,
        saldo_kemarin: dataObj.SaldoKemarin || 0,
        penerimaan_debet: dataObj.PenerimaanDebet || 0,
        penerimaan_antar_teller: dataObj.PenerimaanAntarTeller || 0,
        pembayaran_kredit: dataObj.PembayaranKredit || 0,
        pembayaran_antar_teller: dataObj.PembayaranAntarTeller || 0,
        saldo_hari_ini: dataObj.SaldoHariIni || 0,
        saldo_fisik: dataObj.SaldoFisik || 0,
        selisih: dataObj.Selisih || 0,
        kode_cabang: dataObj.KodeCabang || dataObj.kodeCabang || "",
        kode_wilayah: dataObj.KodeWilayah || dataObj.kodeWilayah || "",
        selisih_pembulatan: dataObj.SelisihPembulatan || 0,
        estim_debet: dataObj.EstimDebet || dataObj.estimDebet || 0,
        estim_kredit: dataObj.EstimKredit || dataObj.estimKredit || 0,
      };

      const { error } = await supabase.from("posisi_kas").upsert(record, {
        onConflict: "tanggal, user_estim",
      });

      if (error) throw error;
      return successResponse("Saved");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
