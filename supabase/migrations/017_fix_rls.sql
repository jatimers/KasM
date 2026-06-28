-- =============================================
-- MIGRASI: Fix RLS Security (Supabase Security Warning)
-- File: 017_fix_rls.sql
-- Date: 2026-06-28
-- =============================================

-- DROP overly permissive policies
DROP POLICY IF EXISTS "Allow authenticated access" ON users;
DROP POLICY IF EXISTS "Allow authenticated access" ON posisi_kas;
DROP POLICY IF EXISTS "Allow authenticated access" ON bon_setor;
DROP POLICY IF EXISTS "Allow authenticated access" ON arsip_bon_setor;
DROP POLICY IF EXISTS "Allow authenticated access" ON saldo_awal_ht;
DROP POLICY IF EXISTS "Allow authenticated access" ON perkiraan_bon_setor;
DROP POLICY IF EXISTS "Allow authenticated access" ON pesanan_nasabah;
DROP POLICY IF EXISTS "Allow authenticated access" ON hari_libur;
DROP POLICY IF EXISTS "Allow authenticated access" ON data_pegawai;
DROP POLICY IF EXISTS "Allow authenticated access" ON data_pejabat_ht;
DROP POLICY IF EXISTS "Allow authenticated access" ON setting_fonnte;
DROP POLICY IF EXISTS "Allow authenticated access" ON setting_wa_gateway;
DROP POLICY IF EXISTS "Allow authenticated access" ON db_atm;
DROP POLICY IF EXISTS "Allow authenticated access" ON db_cit_atm;
DROP POLICY IF EXISTS "Allow authenticated access" ON db_tukab;

-- =============================================
-- USERS: Hanya lihat data sendiri + sembunyikan password
-- =============================================
CREATE POLICY "Users read own data" ON users
  FOR SELECT TO authenticated
  USING (user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim'));

CREATE POLICY "Admin full access users" ON users
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND u.role = 'admin'));

-- Sembunyikan kolom password dari REST API (hanya service_role yg bisa lihat)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE users FROM anon, authenticated;
GRANT SELECT (id, kode_wilayah, kode_cabang, nama_unit, nama_user, role, user_estim, created_at) ON users TO authenticated;
GRANT ALL ON TABLE users TO service_role;

-- =============================================
-- POSISI KAS, BON SETOR, dll: Hanya lihat data sendiri
-- =============================================
CREATE POLICY "Users read own posisi_kas" ON posisi_kas
  FOR SELECT TO authenticated
  USING (user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim')
      OR kode_wilayah = (SELECT kode_wilayah FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') LIMIT 1));

CREATE POLICY "Admin all access posisi_kas" ON posisi_kas
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND role = 'admin'));

CREATE POLICY "Users read own bon_setor" ON bon_setor
  FOR SELECT TO authenticated
  USING (user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim')
      OR kode_wilayah = (SELECT kode_wilayah FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') LIMIT 1));

CREATE POLICY "Admin all access bon_setor" ON bon_setor
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND role = 'admin'));

-- =============================================
-- SETTING WA GATEWAY & FONNTE: Hanya admin
-- =============================================
CREATE POLICY "Admin only setting_wa_gateway" ON setting_wa_gateway
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND role = 'admin'));

CREATE POLICY "Admin only setting_fonnte" ON setting_fonnte
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND role = 'admin'));

-- =============================================
-- UNIT KERJA: Public read tetap OK (master data), admin write
-- =============================================
DROP POLICY IF EXISTS "Admin full access unit_kerja" ON unit_kerja;
DROP POLICY IF EXISTS "All users read unit_kerja" ON unit_kerja;

CREATE POLICY "Public read unit_kerja" ON unit_kerja
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Admin write unit_kerja" ON unit_kerja
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND role = 'admin'));

-- =============================================
-- HARI LIBUR: All read, admin write
-- =============================================
CREATE POLICY "All read hari_libur" ON hari_libur
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin write hari_libur" ON hari_libur
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE user_estim = (current_setting('request.jwt.claims', true)::json ->> 'user_estim') AND role = 'admin'));
