// Edge Function: /api/unit-kerja
// Master data unit kerja — referensi dropdown Kelola User

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

interface UnitKerjaData {
  id?: string;
  nip: string;
  nama_pegawai: string;
  nama_unit: string;
  kode_cabang: string;
  nama_cabang: string;
  kode_wilayah: string;
  nama_wilayah: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const unitId = pathParts.length > 2 ? pathParts[2] : null;

    // GET — List all unit kerja
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("unit_kerja")
        .select("*")
        .order("id");

      if (error) throw error;

      const result = (data || []).map((u: Record<string, unknown>) => ({
        id: u.id,
        nip: cleanStr(u.nip as string),
        nama_pegawai: u.nama_pegawai,
        nama_unit: u.nama_unit,
        kode_cabang: cleanStr(u.kode_cabang as string),
        nama_cabang: u.nama_cabang,
        kode_wilayah: cleanStr(u.kode_wilayah as string),
        nama_wilayah: u.nama_wilayah,
      }));

      return successResponse(result);
    }

    // POST — Save unit kerja (create or update)
    if (req.method === "POST") {
      const body: UnitKerjaData = await req.json();

      if (!body.nama_pegawai || !body.nama_unit) {
        return errorResponse("Nama Pegawai dan Nama Unit wajib diisi!");
      }

      if (body.id) {
        const { error } = await supabase
          .from("unit_kerja")
          .update({
            nip: body.nip,
            nama_pegawai: body.nama_pegawai,
            nama_unit: body.nama_unit,
            kode_cabang: body.kode_cabang,
            nama_cabang: body.nama_cabang,
            kode_wilayah: body.kode_wilayah,
            nama_wilayah: body.nama_wilayah,
          })
          .eq("id", body.id);

        if (error) throw error;
        return successResponse("Unit Kerja berhasil diupdate");
      } else {
        const { error } = await supabase
          .from("unit_kerja")
          .insert({
            nip: body.nip,
            nama_pegawai: body.nama_pegawai,
            nama_unit: body.nama_unit,
            kode_cabang: body.kode_cabang,
            nama_cabang: body.nama_cabang,
            kode_wilayah: body.kode_wilayah,
            nama_wilayah: body.nama_wilayah,
          });

        if (error) throw error;
        return successResponse("Unit Kerja berhasil disimpan");
      }
    }

    // DELETE — Delete unit kerja
    if (req.method === "DELETE" && unitId) {
      const { error } = await supabase
        .from("unit_kerja")
        .delete()
        .eq("id", unitId);

      if (error) throw error;
      return successResponse("Unit Kerja berhasil dihapus");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
