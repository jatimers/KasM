// =============================================
// Konfigurasi Kas Monitor — Supabase
// =============================================

const CONFIG = {
  API_URL: "https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1",
  SUPABASE_URL: "https://jwsfsczgyqphoyflpjnm.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDM0MjYsImV4cCI6MjA5NzE3OTQyNn0.seVnStDF6xsLum4N1075J6uPncMPiCsANU7YROMfisU",
};

// =============================================
// Auth Token Management
// =============================================

function getToken() {
  var token = localStorage.getItem("kasmonitor_token");
  return token || "";
}

function setToken(token) {
  localStorage.setItem("kasmonitor_token", token);
}

function clearToken() {
  localStorage.removeItem("kasmonitor_token");
}

// =============================================
// API Call Helper (replaces google.script.run)
// =============================================

async function callApi(endpoint, method, body) {
  method = method || "GET";
  body = body || null;

  var url = CONFIG.API_URL + endpoint;
  var headers = {
    "Content-Type": "application/json",
  };

  var token = getToken();
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  var options = {
    method: method,
    headers: headers,
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  console.log("API Call:", method, url, body);

  var res = await fetch(url, options);

  if (!res.ok) {
    var errData = await res.json().catch(function() { return { error: "HTTP " + res.status }; });
    throw new Error(errData.error || "HTTP Error " + res.status);
  }

  var json = await res.json();

  if (!json.success) {
    throw new Error(json.error || "Unknown API error");
  }

  return json.data;
}

async function callApiGet(endpoint, params) {
  var url = endpoint;
  if (params) {
    var searchParams = new URLSearchParams(params);
    url += "?" + searchParams.toString();
  }
  return callApi(url, "GET");
}

async function callApiPost(endpoint, body) {
  return callApi(endpoint, "POST", body);
}

async function callApiDelete(endpoint) {
  return callApi(endpoint, "DELETE");
}
