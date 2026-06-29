// Edge Function: /api/perkiraan
// Ported from: getPerkiraanTeller(), savePerkiraanTeller(),
//   getRekapPerkiraanHT() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit, formatSafeString, getWIBISOString } from "../_shared/utils.ts";

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
    const tglHariIni = url.searchParams.get("tglHariIni") ?? "";

    // GET
    if (req.method === "GET") {
      // getPerkiraanTeller - get single user's perkiraan
      if (action === "teller") {
        const { data, error } = await supabase
          .from("perkiraan_bon_setor")
          .select("*")
          .eq("tanggal", tgl)
          .eq("user_estim", userEstim)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          return successResponse({ p100k_setor: 0, p100k_bon: 0, p50k_setor: 0, p50k_bon: 0 });
        }

        return successResponse({
          p100k_setor: parseFloat(String(data.p100k_setor)) || 0,
          p100k_bon: parseFloat(String(data.p100k_bon)) || 0,
          p50k_setor: parseFloat(String(data.p50k_setor)) || 0,
          p50k_bon: parseFloat(String(data.p50k_bon)) || 0,
        });
      }

      // getRekapPerkiraanHT - get all tellers' perkiraan for wilayah
      if (action === "rekap") {
        // Get user map
        const { data: users } = await supabase.from("users").select("*");
        const userMap: Record<string, { namaUnit: string }> = {};
        for (const u of (users || [])) {
          userMap[normalizeUnit(u.user_estim)] = { namaUnit: u.nama_unit };
        }

        // Get perkiraan data
        let query = supabase.from("perkiraan_bon_setor").select("*").eq("tanggal", tgl);
        if (kodeWilayah !== "ALL") {
          query = query.eq("kode_wilayah", kodeWilayah);
        }

        const { data, error } = await query;
        if (error) throw error;

        const result = [];
        for (const row of (data || [])) {
          const uEst = cleanStr(row.user_estim);
          const info = userMap[normalizeUnit(uEst)] || { namaUnit: "Unit: " + uEst };

          let waktuFix = "-";
          if (row.waktu_input) {
            const d = new Date(row.waktu_input);
            waktuFix = d.toTimeString().substring(0, 5);
          }

          result.push({
            userEstim: uEst,
            namaUnit: info.namaUnit,
            p100k_setor: parseFloat(String(row.p100k_setor)) || 0,
            p100k_bon: parseFloat(String(row.p100k_bon)) || 0,
            p50k_setor: parseFloat(String(row.p50k_setor)) || 0,
            p50k_bon: parseFloat(String(row.p50k_bon)) || 0,
            waktuInput: waktuFix,
          });
        }

        // Get khasanah ULE saldo dari saldo_awal_ht
        let k100 = 0, k50 = 0;
        try {
          // Ambil saldo ULE terbaru (tanggal <= tgl yang diminta)
          const { data: saldoULE } = await supabase
            .from("saldo_awal_ht")
            .select("tanggal, pecahan, nominal")
            .eq("kategori", "ULE")
            .lte("tanggal", tgl)
            .order("tanggal", { ascending: false });

          if (saldoULE && saldoULE.length > 0) {
            const latestTgl = saldoULE[0].tanggal;
            for (const row of saldoULE) {
              if (row.tanggal !== latestTgl) continue;
              const pec = parseInt(String(row.pecahan));
              if (pec === 100000) k100 += Number(row.nominal) || 0;
              if (pec === 50000) k50 += Number(row.nominal) || 0;
            }
          }
        } catch (_) {
          // Fallback ke 0 jika query gagal
          console.warn("[perkiraan/rekap] Gagal query saldo_awal_ht, khasanah default ke 0");
        }

        return successResponse({
          list: result,
          khasanah100: k100,
          khasanah50: k50,
        });
      }

      return errorResponse("Missing action parameter", 400);
    }

    // POST - Save perkiraan teller
    if (req.method === "POST") {
      const obj = await req.json();

      const record = {
        tanggal: obj.tanggal,
        user_estim: obj.userEstim || obj.user_estim,
        kode_wilayah: obj.kodeWilayah || obj.kode_wilayah,
        p100k_setor: parseInt(String(obj.p100k_setor)) || 0,
        p100k_bon: parseInt(String(obj.p100k_bon)) || 0,
        p50k_setor: parseInt(String(obj.p50k_setor)) || 0,
        p50k_bon: parseInt(String(obj.p50k_bon)) || 0,
        waktu_input: getWIBISOString(),
      };

      const { error } = await supabase
        .from("perkiraan_bon_setor")
        .upsert(record, { onConflict: "tanggal, user_estim" });

      if (error) throw error;

      // Auto-trigger notifikasi analisa kebutuhan TUKAB setelah simpan
      try {
        const SB_URL = Deno.env.get("SB_URL") ?? "";
        const SB_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
        const kdWil = obj.kodeWilayah || obj.kode_wilayah || "ALL";
        fetch(`${SB_URL}/functions/v1/notif-wa-gateway`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SB_KEY}`
          },
          body: JSON.stringify({
            action: "analisa-tukab",
            tanggal: obj.tanggal,
            kodeWilayah: kdWil
          })
        }).catch(e => console.warn("[perkiraan] Notif TUKAB gagal:", e.message));
      } catch (e) {
        console.warn("[perkiraan] Gagal trigger notif TUKAB:", e);
      }

      return successResponse("Saved");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
