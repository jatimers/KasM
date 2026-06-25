-- Migration 014: Tambah toggle on/off notifikasi WA
-- Digunakan untuk menonaktifkan sementara notifikasi WA saat testing fitur baru
-- Scheduled cron jobs (daily-laporan-ht, daily-perkiraan-h1) TIDAK terpengaruh toggle ini

ALTER TABLE setting_fonnte ADD COLUMN IF NOT EXISTS notif_enabled BOOLEAN DEFAULT true;
