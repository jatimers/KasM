// Edge Function: /api/auth/login
// Ported from: doLogin() in Code.gs

import { corsResponse, successResponse, errorResponse, getCorsHeaders } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";
import { cleanStr, verifyPassword } from "../_shared/utils.ts";

interface LoginRequest {
  username: string;
  password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    const supabase = getSupabaseAdmin();
    const body: LoginRequest = await req.json();
    const inputUser = String(body.username).trim();
    const inputPass = String(body.password).trim();

    if (!inputUser || !inputPass) {
      return errorResponse("Kode User & Password wajib diisi!");
    }

    const { data: usersByName, error } = await supabase
      .from("users")
      .select("*")
      .eq("nama_user", inputUser)
      .limit(1);

    if (error) throw error;

    let user = usersByName?.[0];

    if (!user) {
      const { data: usersByEstim } = await supabase
        .from("users")
        .select("*")
        .eq("user_estim", inputUser)
        .limit(1);

      user = usersByEstim?.[0];
    }

    if (!user) {
      return errorResponse("Kode User atau Password salah!");
    }

    const valid = await verifyPassword(inputPass, user.password);

    if (!valid) {
      return errorResponse("Kode User atau Password salah!");
    }

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
