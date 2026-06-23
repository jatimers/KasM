-- =============================================
-- MIGRASI: Tabel db_tukab — Data TUKAB
-- =============================================

CREATE TABLE db_tukab (
  id SERIAL PRIMARY KEY,
  tgl_transaksi DATE NOT NULL,
  bank TEXT NOT NULL,
  nominal_tukab INTEGER NOT NULL DEFAULT 0,
  user_estim TEXT NOT NULL,
  kode_wilayah TEXT NOT NULL,
  kode_cabang TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tukab_tgl ON db_tukab(tgl_transaksi);
CREATE INDEX idx_tukab_wilayah ON db_tukab(kode_wilayah);

ALTER TABLE db_tukab ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated access" ON db_tukab
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
