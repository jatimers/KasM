// Edge Function: /api/bon-setor
// Ported from: saveBonSetorBatch(), deleteTransaksiFisik(),
//   getHistoryBonSetor(), getRekapTrxFisikTeller(),
//   getSetorSoreKemarin(), getSuggestedSetorSore(),
//   getDashboardData() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, normalizeUnit, formatSafeString } from "../_shared/utils.ts";

interface BonSetorRow {
  id_transaksi: string;
  tanggal: string;
  user_estim: string;
  tipe: string;
  kategori: string;
  pecahan: string;
  lembar: number;
  nominal: number;
  kode_cabang: string;
  kode_wilayah: string;
  scope: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Supabase memberi path: /bon-setor/ID_TRANSACTION (tanpa prefix /functions/v1)
    // pathParts = ['bon-setor', 'ID_TRANSACTION'], jadi index 1 = ID
    const idTrx = pathParts.length > 1 ? pathParts[1] : (url.searchParams.get("id") || null);

    // GET - Query bon_setor
    if (req.method === "GET") {
      const action = url.searchParams.get("action");
      const userEstim = url.searchParams.get("userEstim") ?? "";
      const tgl = url.searchParams.get("tanggal") ?? "";
      const kodeWilayah = url.searchParams.get("kodeWilayah") ?? "ALL";
      const tipeFilter = url.searchParams.get("tipeFilter") ?? "";

      // getHistoryBonSetor
      if (action === "history") {
        let query = supabase.from("bon_setor").select("*")
          .eq("user_estim", userEstim)
          .order("created_at", { ascending: false })
          .limit(100000);

        if (tgl) {
          query = query.eq("tanggal", tgl);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Group by id_transaksi
        const historyMap = new Map<string, {
          idTransaksi: string;
          tanggal: string;
          tipe: string;
          scope: string;
          total: number;
          details: Array<{ kategori: string; pecahan: string; lembar: number; nominal: number }>;
          userEstim: string;
        }>();

        for (const row of (data || [])) {
          const id = cleanStr(row.id_transaksi);
          if (!historyMap.has(id)) {
            historyMap.set(id, {
              idTransaksi: id,
              tanggal: formatSafeString(row.tanggal),
              tipe: row.tipe,
              scope: row.scope || "KHASANAH",
              total: 0,
              details: [],
              userEstim: cleanStr(row.user_estim),
            });
          }
          const entry = historyMap.get(id)!;
          const nominal = parseFloat(String(row.nominal)) || 0;
          entry.total += nominal;

          const pecVal = parseInt(String(row.pecahan));
          const lembar = isNaN(pecVal) ? 1 : Math.floor(nominal / pecVal);
          if (nominal > 0) {
            entry.details.push({
              kategori: row.kategori,
              pecahan: String(row.pecahan),
              lembar,
              nominal,
            });
          }
        }

        return successResponse(Array.from(historyMap.values()).reverse());
      }

      // getRekapTrxFisikTeller
      if (action === "rekap-fisik") {
        const { data, error } = await supabase
          .from("bon_setor")
          .select("*")
          .eq("tanggal", tgl)
          .eq("user_estim", userEstim);

        if (error) throw error;

        const res = {
          bonPagi: 0, bonTambahan: 0, setorTambahan: 0, setorSore: 0,
          penerimaanDebet: 0, pembayaranKredit: 0, penerimaanAntar: 0,
          pembayaranAntar: 0, isSaved: false, selisihPembulatan: 0,
          estimDebet: 0, estimKredit: 0,
        };

        for (const row of (data || [])) {
          const tipe = row.tipe;
          const nominal = parseFloat(String(row.nominal)) || 0;
          const scope = normalizeUnit(row.scope || "KHASANAH");

          if (tipe === "BON PAGI" || tipe === "SALDO AWAL") res.bonPagi += nominal;
          else if (tipe === "SETOR SORE") res.setorSore += nominal;
          else if (tipe === "BON TAMBAHAN" || tipe === "BON") {
            if (scope === "KHASANAH") res.bonTambahan += nominal;
            else res.penerimaanAntar += nominal;
          } else if (tipe === "SETOR TAMBAHAN" || tipe === "SETOR") {
            if (scope === "KHASANAH") res.setorTambahan += nominal;
            else res.pembayaranAntar += nominal;
          } else if (tipe === "PENERIMAAN KAS") res.penerimaanDebet += nominal;
          else if (tipe === "PEMBAYARAN KAS") res.pembayaranKredit += nominal;
          else if (tipe === "PENERIMAAN ANTAR TELLER") res.penerimaanAntar += nominal;
          else if (tipe === "PEMBAYARAN ANTAR TELLER") res.pembayaranAntar += nominal;
        }

        // Check posisi_kas for isSaved
        const { data: posData } = await supabase
          .from("posisi_kas")
          .select("selisih_pembulatan, penerimaan_debet, penerimaan_antar_teller, pembayaran_kredit, pembayaran_antar_teller, estim_debet, estim_kredit")
          .eq("tanggal", tgl)
          .eq("user_estim", userEstim)
          .maybeSingle();

        if (posData) {
          res.isSaved = true;
          res.penerimaanDebet = parseFloat(String(posData.penerimaan_debet)) || 0;
          res.penerimaanAntar = parseFloat(String(posData.penerimaan_antar_teller)) || 0;
          res.pembayaranKredit = parseFloat(String(posData.pembayaran_kredit)) || 0;
          res.pembayaranAntar = parseFloat(String(posData.pembayaran_antar_teller)) || 0;
          res.selisihPembulatan = parseFloat(String(posData.selisih_pembulatan)) || 0;
          res.estimDebet = parseFloat(String(posData.estim_debet)) || 0;
          res.estimKredit = parseFloat(String(posData.estim_kredit)) || 0;
        }

        return successResponse(res);
      }

      // getSetorSoreKemarin
      if (action === "setor-sore-kemarin") {
        const { data, error } = await supabase
          .from("bon_setor")
          .select("*")
          .eq("tanggal", tgl)
          .eq("user_estim", userEstim)
          .eq("tipe", "SETOR SORE");

        if (error) throw error;

        const mapFisik: Record<string, number> = {};
        for (const row of (data || [])) {
          const key = cleanStr(row.kategori) + "_" + cleanStr(String(row.pecahan));
          mapFisik[key] = (mapFisik[key] || 0) + (parseFloat(String(row.nominal)) || 0);
        }

        const result = [];
        for (const k in mapFisik) {
          if (mapFisik[k] > 0) {
            const p = k.split("_");
            const nom = mapFisik[k];
            const pec = parseInt(p[1]);
            const isStr = isNaN(pec);
            result.push({
              kategori: p[0],
              pecahan: isStr ? p[1] : pec,
              lembar: isStr ? 1 : Math.floor(nom / pec),
              nominal: nom,
            });
          }
        }

        return successResponse(result);
      }

      // getSuggestedSetorSore
      if (action === "suggested-setor") {
        const { data, error } = await supabase
          .from("bon_setor")
          .select("*")
          .eq("tanggal", tgl)
          .eq("user_estim", userEstim);

        if (error) throw error;

        const mapFisik: Record<string, number> = {};
        for (const row of (data || [])) {
          const scope = normalizeUnit(row.scope || "KHASANAH");
          if (scope !== "HEAD TELLER") continue;

          const key = cleanStr(row.kategori) + "_" + cleanStr(String(row.pecahan));
          const nominal = parseFloat(String(row.nominal)) || 0;
          const tipe = row.tipe;

          if (["BON PAGI", "BON TAMBAHAN", "BON", "PENERIMAAN KAS", "PENERIMAAN ANTAR TELLER", "SALDO AWAL"].includes(tipe)) {
            mapFisik[key] = (mapFisik[key] || 0) + nominal;
          } else if (["SETOR TAMBAHAN", "SETOR", "PEMBAYARAN KAS", "PEMBAYARAN ANTAR TELLER", "SETOR SORE"].includes(tipe)) {
            if (tipe !== "SETOR SORE") mapFisik[key] = (mapFisik[key] || 0) - nominal;
          }
        }

        const result = [];
        for (const k in mapFisik) {
          if (mapFisik[k] > 0) {
            const p = k.split("_");
            const nom = mapFisik[k];
            const pec = parseInt(p[1], 10);
            const isStr = isNaN(pec);
            result.push({
              kategori: p[0],
              pecahan: isStr ? p[1] : pec,
              lembar: isStr ? 1 : Math.floor(nom / pec),
              nominal: nom,
            });
          }
        }

        return successResponse(result);
      }

      // getDashboardData
      if (action === "dashboard") {
        const { data, error } = await supabase
          .from("bon_setor")
          .select("*")
          .eq("user_estim", userEstim)
          .eq("tanggal", tgl);

        if (error) throw error;

        let tBon = 0, tSetor = 0, tTerima = 0, tBayar = 0;
        for (const row of (data || [])) {
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
      }

      // getRekapGlobalMutasiTeller
      if (action === "rekap-global") {
        let query = supabase.from("bon_setor").select("*")
          .eq("tanggal", tgl);

        if (kodeWilayah !== "ALL") {
          query = query.eq("kode_wilayah", kodeWilayah);
        }

        const { data, error } = await query.order("created_at");
        if (error) throw error;

        const summaryMap = new Map<string, {
          idTransaksi: string;
          userEstim: string;
          status: string;
          nominalGlobal: number;
        }>();

        for (const row of (data || [])) {
          const idTrx = String(row.id_transaksi).trim();
          if (!idTrx) continue;

          const tipeStatus = String(row.tipe).toUpperCase().trim();
          if (tipeFilter && tipeFilter !== "SEMUA" && tipeStatus !== tipeFilter) continue;

          if (!summaryMap.has(idTrx)) {
            summaryMap.set(idTrx, {
              idTransaksi: idTrx,
              userEstim: cleanStr(row.user_estim),
              status: tipeStatus,
              nominalGlobal: 0,
            });
          }
          summaryMap.get(idTrx)!.nominalGlobal += parseFloat(String(row.nominal)) || 0;
        }

        return successResponse(Array.from(summaryMap.values()));
      }

      // Default: query by params
      let query = supabase.from("bon_setor").select("*");
      if (tgl) query = query.eq("tanggal", tgl);
      if (userEstim) query = query.eq("user_estim", userEstim);

      const { data, error } = await query;
      if (error) throw error;
      return successResponse(data);
    }

    // POST - Save batch (saveBonSetorBatch)
    if (req.method === "POST") {
      const body = await req.json();

      if (Array.isArray(body)) {
        // Batch save — supports both array format (from legacy frontend) and object format
        for (const rowRaw of body) {
          let row: any;
          if (Array.isArray(rowRaw)) {
            // Legacy format: [idTrx, tgl, userEstim, tipe, kategori, pecahan, lembar, nominal, kodeCabang, kodeWilayah, scope]
            row = {
              id_transaksi: String(rowRaw[0] || ""),
              tanggal: String(rowRaw[1] || ""),
              user_estim: String(rowRaw[2] || ""),
              tipe: String(rowRaw[3] || ""),
              kategori: String(rowRaw[4] || ""),
              pecahan: String(rowRaw[5] || ""),
              lembar: parseInt(String(rowRaw[6])) || 0,
              nominal: parseInt(String(rowRaw[7])) || 0,
              kode_cabang: String(rowRaw[8] || ""),
              kode_wilayah: String(rowRaw[9] || ""),
              scope: String(rowRaw[10] || "KHASANAH"),
            };
          } else {
            row = rowRaw;
          }

          const safeRow: BonSetorRow = {
            id_transaksi: row.idTransaksi || row.id_transaksi,
            tanggal: row.tanggal,
            user_estim: row.userEstim || row.user_estim,
            tipe: row.tipe,
            kategori: row.kategori,
            pecahan: String(row.pecahan),
            lembar: parseInt(String(row.lembar)) || 0,
            nominal: parseInt(String(row.nominal)) || 0,
            kode_cabang: row.kodeCabang || row.kode_cabang || "",
            kode_wilayah: row.kodeWilayah || row.kode_wilayah || "",
            scope: row.scope || "HEAD TELLER",
          };

          if (safeRow.nominal <= 0) continue;

          // Upsert: try update, if not found, insert
          const { data: existing } = await supabase
            .from("bon_setor")
            .select("id_transaksi")
            .eq("id_transaksi", safeRow.id_transaksi)
            .eq("kategori", safeRow.kategori)
            .eq("pecahan", safeRow.pecahan)
            .maybeSingle();

          if (existing) {
            await supabase.from("bon_setor").update(safeRow)
              .eq("id_transaksi", safeRow.id_transaksi)
              .eq("kategori", safeRow.kategori)
              .eq("pecahan", safeRow.pecahan);
          } else {
            await supabase.from("bon_setor").insert(safeRow);
          }
        }
        return successResponse("Saved Batch");
      } else {
        // Single save
        const { error } = await supabase.from("bon_setor").upsert(body);
        if (error) throw error;
        return successResponse("Saved");
      }
    }

    // DELETE - Delete transaction (via REST API, bypass Supabase client bug)
    if (req.method === "DELETE" && idTrx) {
      const SB_URL = Deno.env.get("SB_URL") ?? "";
      const SB_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
      const encodedId = encodeURIComponent(idTrx);
      const restUrl = `${SB_URL}/rest/v1/bon_setor?id_transaksi=eq.${encodedId}`;

      console.log(`[bon-setor] DELETE id_transaksi=${idTrx} → ${restUrl}`);

      const delResp = await fetch(restUrl, {
        method: "DELETE",
        headers: {
          "apikey": SB_KEY,
          "Authorization": `Bearer ${SB_KEY}`,
        },
      });

      if (!delResp.ok) {
        const errText = await delResp.text();
        console.error(`[bon-setor] DELETE failed: ${delResp.status} ${errText}`);
        throw new Error(`Delete failed: ${delResp.status}`);
      }

      console.log(`[bon-setor] DELETE success for ${idTrx}`);
      return successResponse(`Deleted: ${idTrx}`);
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
