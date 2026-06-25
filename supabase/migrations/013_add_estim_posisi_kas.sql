-- Migration 012: Tambah kolom estim_debet & estim_kredit ke posisi_kas
-- Untuk form Mutasi Debet & Mutasi Kredit di Kalkulator Posisi Kas

ALTER TABLE posisi_kas ADD COLUMN IF NOT EXISTS estim_debet BIGINT DEFAULT 0;
ALTER TABLE posisi_kas ADD COLUMN IF NOT EXISTS estim_kredit BIGINT DEFAULT 0;
