// Shared utility functions (ported from Code.gs)

export function cleanStr(val: unknown): string {
  if (!val && val !== 0) return "";
  return String(val).replace(/^'/, "");
}

export function normalizeUnit(val: unknown): string {
  return cleanStr(val).toString().trim().toUpperCase();
}

export function formatSafeString(val: unknown): string {
  if (!val && val !== 0) return "-";
  if (val instanceof Date) {
    return val.toISOString().split("T")[0];
  }
  return String(val);
}

export function formatTglIndo(dateStr: string): string {
  if (!dateStr || dateStr === "-") return "-";
  const bulanIndo = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parseInt(parts[2], 10)} ${bulanIndo[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
}

// WIB (GMT+7) ISO timestamp untuk waktu_input
export function getWIBISOString(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().replace("Z", "+07:00");
}

// WIB (GMT+7) date string YYYY-MM-DD
export function getWIBDateString(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().split("T")[0];
}

export function getLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function isHashedPassword(stored: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(stored);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LEN_BITS = 512;
const PBKDF2_HASH = "SHA-512";

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEY_LEN_BITS
  );
  return bytesToHex(new Uint8Array(salt)) + ":" + bytesToHex(new Uint8Array(hash));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isHashedPassword(stored)) {
    return password === stored;
  }
  const [saltHex, hashHex] = stored.split(":");
  const salt = hexToBytes(saltHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEY_LEN_BITS
  );
  return bytesToHex(new Uint8Array(hash)) === hashHex;
}

export interface HariLibur {
  tanggal: string;
  keterangan: string;
}

export interface User {
  id: number;
  kode_wilayah: string;
  kode_cabang: string;
  nama_unit: string;
  nama_user: string;
  role: string;
  user_estim: string;
  password: string;
}
