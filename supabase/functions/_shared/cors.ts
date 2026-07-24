const ALLOWED_ORIGINS = [
  "https://jatimers.github.io",
];

function getAllowedOrigin(origin: string | null): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
    return origin;
  }
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return ALLOWED_ORIGINS[0];
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}

export const corsHeaders = getCorsHeaders({ headers: new Headers() } as Request);

export function corsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function successResponse(data: unknown): Response {
  return corsResponse({ success: true, data });
}

export function errorResponse(error: string, status = 400): Response {
  return corsResponse({ success: false, error }, status);
}
