// Edge Function: /api/users
// Ported from: getAllUsers(), saveUserData(), deleteUserData() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

interface UserData {
  id?: string;
  kodeWilayah: string;
  kodeCabang: string;
  namaUnit: string;
  namaUser: string;
  role: string;
  userEstim: string;
  password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // path: api/users or api/users/:id
    const userId = pathParts.length > 2 ? pathParts[2] : null;

    // GET - List all users or filter
    if (req.method === "GET") {
      const kodeWilayah = url.searchParams.get("kodeWilayah");
      let query = supabase.from("users").select("*").order("id");

      if (kodeWilayah && kodeWilayah !== "ALL") {
        query = query.or(`kode_wilayah.eq.${kodeWilayah},kode_wilayah.eq.ALL`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const result = (data || []).map((u: Record<string, unknown>) => ({
        id: u.id,
        kodeWilayah: cleanStr(u.kode_wilayah as string),
        kodeCabang: cleanStr(u.kode_cabang as string),
        namaUnit: u.nama_unit,
        namaUser: cleanStr(u.nama_user as string),
        role: u.role,
        userEstim: cleanStr(u.user_estim as string),
        password: u.password,
      }));

      return successResponse(result);
    }

    // POST - Save user (create or update)
    if (req.method === "POST") {
      const u: UserData = await req.json();

      if (u.id) {
        // Update existing user
        const { error } = await supabase
          .from("users")
          .update({
            kode_wilayah: u.kodeWilayah,
            kode_cabang: u.kodeCabang,
            nama_unit: u.namaUnit,
            nama_user: u.namaUser,
            role: u.role,
            user_estim: u.userEstim,
            password: u.password,
          })
          .eq("id", u.id);

        if (error) throw error;
        return successResponse("Updated");
      } else {
        // Create new user
        const { error } = await supabase.from("users").insert({
          kode_wilayah: u.kodeWilayah,
          kode_cabang: u.kodeCabang,
          nama_unit: u.namaUnit,
          nama_user: u.namaUser,
          role: u.role,
          user_estim: u.userEstim,
          password: u.password,
        });

        if (error) throw error;
        return successResponse("Saved");
      }
    }

    // DELETE - Delete user
    if (req.method === "DELETE" && userId) {
      const { error } = await supabase.from("users").delete().eq("id", userId);
      if (error) throw error;
      return successResponse("Deleted");
    }

    return errorResponse("Method not allowed", 405);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
