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
