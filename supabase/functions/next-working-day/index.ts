// Edge Function: /api/next-working-day
// Ported from: getServerNextWorkingDay(), getNextWorkingDayFrom(),
//   getPreviousWorkingDayBackend(), isWorkingDayBackend() in Code.gs

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { formatSafeString, getWIBDateString } from "../_shared/utils.ts";

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Get today's date in WIB as a Date object (midnight WIB)
function getTodayWIB(): Date {
  const wibStr = getWIBDateString(); // YYYY-MM-DD in WIB
  const parts = wibStr.split("-");
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

async function getLiburMap(supabase: ReturnType<typeof getSupabaseClient>): Promise<Record<string, boolean>> {
  const { data } = await supabase.from("hari_libur").select("tanggal");
  const map: Record<string, boolean> = {};
  for (const row of (data || [])) {
    const tgl = formatSafeString(row.tanggal);
    if (tgl && tgl !== "-") map[tgl] = true;
  }
  return map;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const fromDate = url.searchParams.get("fromDate") ?? "";

    const liburMap = await getLiburMap(supabase);

    // getServerNextWorkingDay
    if (!action || action === "next") {
      const d = getTodayWIB(); // Gunakan WIB agar sesuai zona pengguna
      d.setDate(d.getDate() + 1);
      let limit = 30;

      while (limit > 0) {
        const dayOfWeek = d.getDay();
        const tglStr = formatDate(d);

        if (dayOfWeek === 0 || dayOfWeek === 6 || liburMap[tglStr]) {
          d.setDate(d.getDate() + 1);
        } else {
          return successResponse(tglStr);
        }
        limit--;
      }

      return successResponse(formatDate(new Date()));
    }

    // getNextWorkingDayFrom
    if (action === "from" && fromDate) {
      const parts = fromDate.split("-");
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      d.setDate(d.getDate() + 1);
      let limit = 30;

      while (limit > 0) {
        const dayOfWeek = d.getDay();
        const tglStr = formatDate(d);

        if (dayOfWeek === 6 || dayOfWeek === 0 || liburMap[tglStr]) {
          d.setDate(d.getDate() + 1);
        } else {
          return successResponse(tglStr);
        }
        limit--;
      }

      return successResponse(formatDate(d));
    }

    // getPreviousWorkingDay
    if (action === "prev" && fromDate) {
      const parts = fromDate.split("-");
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      d.setDate(d.getDate() - 1);
      let limit = 30;

      while (limit > 0) {
        const dayOfWeek = d.getDay();
        const tglStr = formatDate(d);

        if (dayOfWeek === 6 || dayOfWeek === 0 || liburMap[tglStr]) {
          d.setDate(d.getDate() - 1);
        } else {
          return successResponse(tglStr);
        }
        limit--;
      }

      return successResponse(formatDate(d));
    }

    return errorResponse("Invalid action", 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse("ERROR: " + msg, 500);
  }
});
