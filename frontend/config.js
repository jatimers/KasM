// =============================================
// Konfigurasi Kas Monitor — Supabase
// =============================================

const CONFIG = {
  // Ganti dengan URL Supabase Edge Functions Anda
  API_URL: "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1",
  SUPABASE_URL: "https://jwsfsczgyqphoyflpjnm.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDM0MjYsImV4cCI6MjA5NzE3OTQyNn0.seVnStDF6xsLum4N1075J6uPncMPiCsANU7YROMfisU",
};

// =============================================
// Auth Token Management
// =============================================

function getToken(): string {
  const token = localStorage.getItem("kasmonitor_token");
  return token || "";
}

function setToken(token: string): void {
  localStorage.setItem("kasmonitor_token", token);
}

function clearToken(): void {
  localStorage.removeItem("kasmonitor_token");
}

// =============================================
// API Call Helper (replaces google.script.run)
// =============================================

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function callApi<T = unknown>(
  endpoint: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body: unknown = null
): Promise<T> {
  const url = CONFIG.API_URL + endpoint;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  console.log("API Call:", method, url, body);

  const res = await fetch(url, options);

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: "HTTP " + res.status }));
    throw new Error((errData as { error?: string }).error || "HTTP Error " + res.status);
  }

  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    throw new Error(json.error || "Unknown API error");
  }

  return json.data as T;
}

// Also expose as callApiGet/callApiPost for convenience
async function callApiGet<T = unknown>(endpoint: string, params?: Record<string, string>): Promise<T> {
  let url = endpoint;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += "?" + searchParams.toString();
  }
  return callApi<T>(url, "GET");
}

async function callApiPost<T = unknown>(endpoint: string, body: unknown): Promise<T> {
  return callApi<T>(endpoint, "POST", body);
}

async function callApiDelete<T = unknown>(endpoint: string): Promise<T> {
  return callApi<T>(endpoint, "DELETE");
}
