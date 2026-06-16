// Edge Function: /api/auth/login
// Ported from: doLogin() in Code.gs

import { corsHeaders, corsResponse, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { cleanStr } from "../_shared/utils.ts";

interface LoginRequest {
  username: string;
  password: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin(); // Use admin to bypass RLS for login
    const body: LoginRequest = await req.json();
    const inputUser = String(body.username).trim();
    const inputPass = String(body.password).trim();

    if (!inputUser || !inputPass) {
      return errorResponse("Kode User & Password wajib diisi!");
    }

    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .eq("nama_user", inputUser)
      .eq("password", inputPass)
      .limit(1);

    if (error) throw error;

    if (!users || users.length === 0) {
      // Try by user_estim as fallback
      const { data: usersByEstim } = await supabase
        .from("users")
        .select("*")
        .eq("user_estim", inputUser)
        .eq("password", inputPass)
        .limit(1);

      if (!usersByEstim || usersByEstim.length === 0) {
        return errorResponse("Kode User atau Password salah!");
      }

      const user = usersByEstim[0];
      return successResponse({
        status: true,
        user: {
          id: user.id,
          kodeWilayah: cleanStr(user.kode_wilayah),
          kodeCabang: cleanStr(user.kode_cabang),
          namaUnit: user.nama_unit,
          namaUser: cleanStr(user.nama_user),
          role: user.role,
          userEstim: cleanStr(user.user_estim),
        },
      });
    }

    const user = users[0];
    return successResponse({
      status: true,
      user: {
        id: user.id,
        kodeWilayah: cleanStr(user.kode_wilayah),
        kodeCabang: cleanStr(user.kode_cabang),
        namaUnit: user.nama_unit,
        namaUser: cleanStr(user.nama_user),
        role: user.role,
        userEstim: cleanStr(user.user_estim),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
