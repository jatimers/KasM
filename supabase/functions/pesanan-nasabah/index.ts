// Edge Function: /api/pesanan-nasabah
// Ported from: getPesananNasabah(), savePesananNasabah(),
//   deletePesananNasabah(), recalcPerkiraanDariPesanan() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { normalizeUnit, getWIBISOString } from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const id = pathParts.length > 2 ? pathParts[2] : null;

    // GET
    if (req.method === "GET") {
      const action = url.searchParams.get("action") ?? "";
      const userEstim = url.searchParams.get("userEstim") ?? "";
      const tgl = url.searchParams.get("tanggal") ?? "";

      let query = supabase
        .from("pesanan_nasabah")
        .select("*")
        .eq("tanggal", tgl)
        .order("waktu_input");

      // action=all: semua pesanan di tgl tsb (untuk rekap)
      if (action !== "all") {
        query = query.eq("user_estim", userEstim);
      }

      const { data, error } = await query;

      if (error) throw error;

      const res = (data || []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        namaNasabah: String(row.nama_nasabah),
        p100k: parseFloat(String(row.p100k)) || 0,
        p50k: parseFloat(String(row.p50k)) || 0,
        waktuInput: String(row.waktu_input),
      }));

      return successResponse(res);
    }

    // POST - Save
    if (req.method === "POST") {
      const obj = await req.json();
      const id = obj.id || "PSN-" + Date.now();
      const waktuNow = getWIBISOString();

      await supabase.from("pesanan_nasabah").insert({
        id,
        tanggal: obj.tanggal,
        user_estim: obj.userEstim || obj.user_estim,
        kode_wilayah: obj.kodeWilayah || obj.kode_wilayah,
        nama_nasabah: obj.namaNasabah || obj.nama_nasabah,
        p100k: obj.p100k || 0,
        p50k: obj.p50k || 0,
        waktu_input: waktuNow,
      });

      // Recalc perkiraan from pesanan
      const { data: pesanan } = await supabase
        .from("pesanan_nasabah")
        .select("*")
        .eq("tanggal", obj.tanggal)
        .eq("user_estim", obj.userEstim || obj.user_estim);

      let total100k = 0, total50k = 0;
      for (const p of (pesanan || [])) {
        total100k += parseFloat(String(p.p100k)) || 0;
        total50k += parseFloat(String(p.p50k)) || 0;
      }

      await supabase.from("perkiraan_bon_setor").upsert({
        tanggal: obj.tanggal,
        user_estim: obj.userEstim || obj.user_estim,
        kode_wilayah: obj.kodeWilayah || obj.kode_wilayah,
        p100k_setor: 0,
        p100k_bon: total100k,
        p50k_setor: 0,
        p50k_bon: total50k,
        waktu_input: waktuNow,
      }, { onConflict: "tanggal, user_estim" });

      // Trigger notifikasi analisa TUKAB via WA Gateway
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
        }).catch(e => console.warn("[pesanan-nasabah] Notif TUKAB gagal:", e.message));
      } catch (e) {
        console.warn("[pesanan-nasabah] Gagal trigger notif TUKAB:", e);
      }

      return successResponse("Saved");
    }

    // DELETE
    if (req.method === "DELETE" && id) {
      const tgl = url.searchParams.get("tanggal") ?? "";
      const userEstim = url.searchParams.get("userEstim") ?? "";

      const { error } = await supabase.from("pesanan_nasabah").delete().eq("id", id);
      if (error) throw error;

      // Recalc perkiraan
      const { data: pesanan } = await supabase
        .from("pesanan_nasabah")
        .select("*")
        .eq("tanggal", tgl)
        .eq("user_estim", userEstim);

      let total100k = 0, total50k = 0;
      for (const p of (pesanan || [])) {
        total100k += parseFloat(String(p.p100k)) || 0;
        total50k += parseFloat(String(p.p50k)) || 0;
      }

      await supabase.from("perkiraan_bon_setor").upsert({
        tanggal: tgl,
        user_estim: userEstim,
        p100k_setor: 0,
        p100k_bon: total100k,
        p50k_setor: 0,
        p50k_bon: total50k,
        waktu_input: getWIBISOString(),
      }, { onConflict: "tanggal, user_estim" });

      return successResponse("Deleted");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
