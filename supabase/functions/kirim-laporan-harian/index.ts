// Edge Function: /api/kirim-laporan-harian
// Frontend mengirim laporan akhir hari sebagai lampiran PDF base64 (html2pdf di browser).
// Body: { tanggal, kodeWilayah, userEstim, role, attachments: [{ filename, content }], preview? }

import { corsHeaders, successResponse, errorResponse } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { cleanStr, formatTglIndo } from "../_shared/utils.ts";

const RESEND_URL = "https://api.resend.com/emails";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const body = await req.json();
    const tanggal = cleanStr(body.tanggal || "");
    const kodeWilayah = cleanStr(body.kodeWilayah || "ALL");
    const userEstim = cleanStr(body.userEstim || "");
    const role = cleanStr(body.role || "").toLowerCase();
    const preview = !!body.preview;
    const attachments: Array<{ filename?: string; content?: string }> = Array.isArray(body.attachments) ? body.attachments : [];

    if (!tanggal) return errorResponse("Parameter tanggal wajib diisi");

    // 1. Verifikasi user
    const supabase = getSupabaseClient(req);
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("role, nama_user")
      .eq("user_estim", userEstim)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) return errorResponse("User tidak dikenal", 401);
    const userRole = String(user.role || "").toLowerCase();
    const effRole = role === userRole ? role : userRole;
    if (!["teller", "admin"].includes(effRole)) {
      return errorResponse("Role tidak diizinkan mengirim laporan", 403);
    }

    // 2. Setting email
    const { data: setting } = await supabase
      .from("setting_email")
      .select("*")
      .order("id")
      .limit(1)
      .maybeSingle();
    if (!setting || !cleanStr(setting.api_key) || !cleanStr(setting.from_email) || !cleanStr(setting.to_emails)) {
      return errorResponse("Tujuan email belum diatur oleh admin", 400);
    }

    // 3. Validasi lampiran PDF
    const validAttachments: Array<{ filename: string; content: string }> = [];
    let totalBytes = 0;
    for (const a of attachments) {
      if (!a || typeof a.content !== "string" || a.content === "") continue;
      const filename = cleanStr(a.filename) || "Lampiran.pdf";
      try {
        const bytes = decodeBase64(a.content);
        totalBytes += bytes.length;
        if (totalBytes > MAX_ATTACHMENT_BYTES) {
          return errorResponse("Total ukuran lampiran melebihi batas 10 MB", 400);
        }
        validAttachments.push({ filename, content: a.content });
      } catch {
        return errorResponse("Konten lampiran bukan base64 yang valid", 400);
      }
    }
    if (validAttachments.length === 0) {
      return errorResponse("Tidak ada lampiran PDF untuk dikirim", 400);
    }

    if (preview) {
      return successResponse({
        preview: true,
        tanggal,
        kodeWilayah,
        totalAttachment: validAttachments.length,
        filenames: validAttachments.map((a) => a.filename),
      });
    }

    // 4. Kirim email via Resend
    const subject = `Laporan Akhir Hari - ${formatTglIndo(tanggal)}`;
    const html = `<html><body style="font-family:Arial,sans-serif">
      <h2>Laporan Akhir Hari</h2>
      <p>Tanggal: <b>${formatTglIndo(tanggal)}</b></p>
      <p>Wilayah: ${kodeWilayah}</p>
      <p>Dikirim oleh: ${user.nama_user || userEstim}</p>
      <p>Jumlah lampiran: <b>${validAttachments.length}</b> PDF</p>
      </body></html>`;

    const emailResp = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanStr(setting.api_key)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cleanStr(setting.from_email),
        to: cleanStr(setting.to_emails).split(",").map((s: string) => s.trim()).filter(Boolean),
        subject,
        html,
        attachments: validAttachments.map((a) => ({ filename: a.filename, content: a.content })),
      }),
    });

    const emailJson = await emailResp.json().catch(() => ({}));
    if (!emailResp.ok) {
      return errorResponse(`Gagal kirim email: ${emailJson.message || emailResp.statusText || "Resend error"}`, 502);
    }

    return successResponse({
      emailId: emailJson.id || "",
      to: cleanStr(setting.to_emails),
      tanggal,
      totalAttachment: validAttachments.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[kirim-laporan-harian] Exception:", msg);
    return errorResponse("ERROR: " + msg, 500);
  }
});
