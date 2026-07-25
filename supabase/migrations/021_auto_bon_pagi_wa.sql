-- =============================================
-- MIGRASI: Tambah target Auto Bon Pagi
-- Menambahkan kolom target_auto_bon_pagi untuk
-- notifikasi WA setelah Auto Bon Pagi berjalan
-- Date: 2026-07-21
-- =============================================

ALTER TABLE setting_wa_gateway 
ADD COLUMN IF NOT EXISTS target_auto_bon_pagi TEXT DEFAULT '';
