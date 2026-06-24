-- =============================================
-- MIGRASI: Tabel Unit Kerja (Master Data Organisasi)
-- Referensi untuk Kelola User — dropdown wilayah, cabang, unit
-- =============================================

CREATE TABLE IF NOT EXISTS unit_kerja (
  id SERIAL PRIMARY KEY,
  nip TEXT,
  nama_pegawai TEXT NOT NULL,
  nama_unit TEXT NOT NULL,
  kode_cabang TEXT NOT NULL,
  nama_cabang TEXT NOT NULL,
  kode_wilayah TEXT NOT NULL,
  nama_wilayah TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE unit_kerja ENABLE ROW LEVEL SECURITY;

-- Admin only: full access
DROP POLICY IF EXISTS "Admin full access unit_kerja" ON unit_kerja;
CREATE POLICY "Admin full access unit_kerja" ON unit_kerja
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.user_estim = current_setting('request.jwt.claims', true)::json->>'user_estim'
      AND users.role = 'admin'
    )
  );

-- All authenticated users can read
DROP POLICY IF EXISTS "All users read unit_kerja" ON unit_kerja;
CREATE POLICY "All users read unit_kerja" ON unit_kerja
  FOR SELECT
  USING (true);
