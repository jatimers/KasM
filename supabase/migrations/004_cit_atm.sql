-- =============================================
-- MIGRASI: Tabel db_cit_atm — Data CIT ATM
-- =============================================

CREATE TABLE db_cit_atm (
  id SERIAL PRIMARY KEY,
  kode_wilayah TEXT NOT NULL,
  kode_cabang TEXT NOT NULL,
  tgl_transaksi DATE NOT NULL,
  user_atm TEXT NOT NULL,
  nominal_pengisian INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index untuk query umum
CREATE INDEX idx_cit_atm_tgl ON db_cit_atm(tgl_transaksi);
CREATE INDEX idx_cit_atm_wilayah ON db_cit_atm(kode_wilayah);

-- RLS
ALTER TABLE db_cit_atm ENABLE ROW LEVEL SECURITY;

-- Policy: semua user authenticated bisa akses
CREATE POLICY "Allow authenticated access" ON db_cit_atm
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
