-- =============================================
-- MIGRASI: Tambah status_antar di db_tukab
-- =============================================
ALTER TABLE db_tukab ADD COLUMN IF NOT EXISTS status_antar BOOLEAN DEFAULT false;
