-- =============================================
-- MIGRASI: Pengaturan cut-off input Perkiraan Bon
-- File: 023_setting_perkiraan.sql
-- =============================================

CREATE TABLE IF NOT EXISTS setting_perkiraan (
  id SERIAL PRIMARY KEY,
  cutoff_enabled BOOLEAN NOT NULL DEFAULT true,
  cutoff_time TEXT NOT NULL DEFAULT '12:00',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE setting_perkiraan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access" ON setting_perkiraan;
CREATE POLICY "Allow authenticated access" ON setting_perkiraan
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed 1 baris default (guard anti-duplikat)
INSERT INTO setting_perkiraan (cutoff_enabled, cutoff_time)
SELECT true, '12:00' WHERE NOT EXISTS (SELECT 1 FROM setting_perkiraan);
