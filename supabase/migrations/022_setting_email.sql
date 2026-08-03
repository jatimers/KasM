-- =============================================
-- MIGRASI: Setting Email Laporan Akhir Hari (Resend)
-- File: 022_setting_email.sql
-- =============================================

CREATE TABLE IF NOT EXISTS setting_email (
  id SERIAL PRIMARY KEY,
  api_key TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_emails TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE setting_email ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated access" ON setting_email
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
