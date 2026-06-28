-- =============================================
-- MIGRASI: Fonnte → WhatsApp Gateway (wa.matradata.com)
-- File: 002_wa_gateway.sql
-- Date: 2026-06-28
-- =============================================

-- 1. Buat tabel setting_wa_gateway (menggantikan setting_fonnte)
CREATE TABLE setting_wa_gateway (
  id SERIAL PRIMARY KEY,
  kode_wilayah TEXT NOT NULL DEFAULT 'ALL',
  api_key TEXT NOT NULL DEFAULT '',
  no_hp TEXT DEFAULT '',
  waktu TIME DEFAULT '16:00',
  target_kf TEXT DEFAULT '',
  target_tukab TEXT DEFAULT '',
  target_input_tukab TEXT DEFAULT '',
  waktu_perkiraan_h1 TIME DEFAULT '07:00',
  target_perkiraan_h1 TEXT DEFAULT '',
  target_posisi_kas TEXT DEFAULT '',
  notif_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Migrasi data dari setting_fonnte ke setting_wa_gateway
-- WA Gateway pakai single api_key (ambil dari token atau token_kf yg ada isinya)
INSERT INTO setting_wa_gateway (
  kode_wilayah, api_key, no_hp, waktu,
  target_kf, target_tukab, target_input_tukab,
  waktu_perkiraan_h1, target_perkiraan_h1, target_posisi_kas,
  notif_enabled
)
SELECT
  kode_wilayah,
  COALESCE(NULLIF(token_kf, ''), token, '') as api_key,
  no_hp, waktu::TIME,
  target_kf, target_tukab, target_input_tukab,
  waktu_perkiraan_h1::TIME, target_perkiraan_h1, target_posisi_kas,
  notif_enabled
FROM setting_fonnte
WHERE token != '' OR token_kf != ''
LIMIT 1;

-- 3. RLS
ALTER TABLE setting_wa_gateway ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access" ON setting_wa_gateway FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Index
CREATE INDEX idx_setting_wa_gateway_kode_wilayah ON setting_wa_gateway(kode_wilayah);
