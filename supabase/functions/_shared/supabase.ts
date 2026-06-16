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

// Helper: fetch all rows with automatic pagination (bypasses 1000-row limit)
export async function fetchAll(queryBuilder: any): Promise<any[]> {
  let allData: any[] = [];
  let start = 0;
  const size = 900;
  while (true) {
    const { data, error } = await queryBuilder.range(start, start + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < size) break;
    start += size;
  }
  return allData;
}
