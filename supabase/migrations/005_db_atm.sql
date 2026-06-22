-- =============================================
-- MIGRASI: Tabel db_atm — Data ATM per KF/Teller
-- =============================================

CREATE TABLE db_atm (
  id SERIAL PRIMARY KEY,
  kode_wilayah TEXT NOT NULL,
  kode_cabang TEXT,
  user_estim TEXT NOT NULL,
  nama_atm TEXT NOT NULL,
  denom TEXT NOT NULL DEFAULT '100000',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index
CREATE INDEX idx_db_atm_user ON db_atm(user_estim);
CREATE INDEX idx_db_atm_wilayah ON db_atm(kode_wilayah);

-- RLS
ALTER TABLE db_atm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated access" ON db_atm
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
