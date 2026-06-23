-- =============================================
-- MIGRASI: Pisahkan target notif Analisa TUKAB & Input TUKAB
-- =============================================

-- Tambah kolom baru untuk target notifikasi Input CIT TUKAB
ALTER TABLE setting_fonnte ADD COLUMN IF NOT EXISTS target_input_tukab TEXT;
