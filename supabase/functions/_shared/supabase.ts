import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Application-layer auth — all functions use service_role to bypass RLS.
// Authentication is handled by the /auth endpoint at the application level.

function getCredentials() {
  const supabaseUrl = Deno.env.get("SB_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SB_URL or SB_SERVICE_ROLE_KEY environment variables");
  }

  return { supabaseUrl, serviceRoleKey };
}

export function getSupabaseClient(_req?: Request) {
  const { supabaseUrl, serviceRoleKey } = getCredentials();
  return createClient(supabaseUrl, serviceRoleKey);
}

export function getSupabaseAdmin() {
  return getSupabaseClient();
}
