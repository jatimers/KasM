-- =============================================
-- MIGRASI: Kas Monitor — Google Sheets → Supabase
-- File: 001_init.sql
-- =============================================

-- 1. users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  kode_wilayah TEXT NOT NULL DEFAULT 'ALL',
  kode_cabang TEXT NOT NULL DEFAULT 'ALL',
  nama_unit TEXT,
  nama_user TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teller',
  user_estim TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. bon_setor (id_transaksi NOT unique — one txn can have multiple pecahan rows)
CREATE TABLE bon_setor (
  id SERIAL PRIMARY KEY,
  id_transaksi TEXT NOT NULL,
  tanggal DATE NOT NULL,
  user_estim TEXT NOT NULL,
  tipe TEXT NOT NULL,
  kategori TEXT NOT NULL,
  pecahan TEXT NOT NULL,
  lembar INTEGER NOT NULL DEFAULT 0,
  nominal BIGINT NOT NULL DEFAULT 0,
  kode_cabang TEXT,
  kode_wilayah TEXT,
  scope TEXT NOT NULL DEFAULT 'KHASANAH',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(id_transaksi, kategori, pecahan)
);

CREATE INDEX idx_bon_setor_tanggal ON bon_setor(tanggal);
CREATE INDEX idx_bon_setor_user_estim ON bon_setor(user_estim);
CREATE INDEX idx_bon_setor_kode_wilayah ON bon_setor(kode_wilayah);
CREATE INDEX idx_bon_setor_tipe ON bon_setor(tipe);
CREATE INDEX idx_bon_setor_scope ON bon_setor(scope);

-- 3. arsip_bon_setor (same structure as bon_setor)
CREATE TABLE arsip_bon_setor (
  id SERIAL PRIMARY KEY,
  id_transaksi TEXT NOT NULL,
  tanggal DATE NOT NULL,
  user_estim TEXT NOT NULL,
  tipe TEXT NOT NULL,
  kategori TEXT NOT NULL,
  pecahan TEXT NOT NULL,
  lembar INTEGER NOT NULL DEFAULT 0,
  nominal BIGINT NOT NULL DEFAULT 0,
  kode_cabang TEXT,
  kode_wilayah TEXT,
  scope TEXT NOT NULL DEFAULT 'KHASANAH',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(id_transaksi, kategori, pecahan)
);

-- 4. posisi_kas
CREATE TABLE posisi_kas (
  id SERIAL PRIMARY KEY,
  tanggal DATE NOT NULL,
  user_estim TEXT NOT NULL,
  saldo_kemarin BIGINT DEFAULT 0,
  penerimaan_debet BIGINT DEFAULT 0,
  penerimaan_antar_teller BIGINT DEFAULT 0,
  pembayaran_kredit BIGINT DEFAULT 0,
  pembayaran_antar_teller BIGINT DEFAULT 0,
  saldo_hari_ini BIGINT DEFAULT 0,
  saldo_fisik BIGINT DEFAULT 0,
  selisih BIGINT DEFAULT 0,
  kode_cabang TEXT,
  kode_wilayah TEXT,
  selisih_pembulatan BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tanggal, user_estim)
);

CREATE INDEX idx_posisi_kas_tanggal ON posisi_kas(tanggal);
CREATE INDEX idx_posisi_kas_user_estim ON posisi_kas(user_estim);
CREATE INDEX idx_posisi_kas_kode_wilayah ON posisi_kas(kode_wilayah);

-- 5. saldo_awal_ht
CREATE TABLE saldo_awal_ht (
  id SERIAL PRIMARY KEY,
  tanggal DATE NOT NULL,
  user_estim TEXT NOT NULL,
  kategori TEXT NOT NULL,
  pecahan TEXT NOT NULL,
  lembar INTEGER NOT NULL DEFAULT 0,
  nominal BIGINT NOT NULL DEFAULT 0,
  kode_cabang TEXT,
  kode_wilayah TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_saldo_awal_ht_tanggal ON saldo_awal_ht(tanggal);
CREATE INDEX idx_saldo_awal_ht_kode_wilayah ON saldo_awal_ht(kode_wilayah);

-- 6. data_pegawai
CREATE TABLE data_pegawai (
  id SERIAL PRIMARY KEY,
  user_estim_teller TEXT UNIQUE NOT NULL,
  nip_teller TEXT,
  nama_teller TEXT,
  nip_pimkas TEXT,
  nama_pimkas TEXT,
  user_estim_pimkas TEXT
);

-- 7. data_pejabat_ht
CREATE TABLE data_pejabat_ht (
  id SERIAL PRIMARY KEY,
  kode_wilayah TEXT NOT NULL,
  nip_penyelia TEXT,
  nama_penyelia TEXT,
  nip_pbo TEXT,
  nama_pbo TEXT,
  UNIQUE(kode_wilayah)
);

-- 8. setting_fonnte
CREATE TABLE setting_fonnte (
  id SERIAL PRIMARY KEY,
  kode_wilayah TEXT NOT NULL DEFAULT 'ALL',
  token TEXT,
  no_hp TEXT,
  waktu TEXT DEFAULT '16:00',
  token_kf TEXT,
  target_kf TEXT,
  target_tukab TEXT,
  waktu_perkiraan_h1 TEXT DEFAULT '07:00',
  target_perkiraan_h1 TEXT,
  target_posisi_kas TEXT
);

-- 9. perkiraan_bon_setor
CREATE TABLE perkiraan_bon_setor (
  id SERIAL PRIMARY KEY,
  tanggal DATE NOT NULL,
  user_estim TEXT NOT NULL,
  kode_wilayah TEXT,
  p100k_setor BIGINT DEFAULT 0,
  p100k_bon BIGINT DEFAULT 0,
  p50k_setor BIGINT DEFAULT 0,
  p50k_bon BIGINT DEFAULT 0,
  waktu_input TIMESTAMP DEFAULT NOW(),
  UNIQUE(tanggal, user_estim)
);

-- 10. hari_libur
CREATE TABLE hari_libur (
  id SERIAL PRIMARY KEY,
  tanggal DATE UNIQUE NOT NULL,
  keterangan TEXT
);

-- 11. pesanan_nasabah
CREATE TABLE pesanan_nasabah (
  id TEXT PRIMARY KEY,
  tanggal DATE NOT NULL,
  user_estim TEXT NOT NULL,
  kode_wilayah TEXT,
  nama_nasabah TEXT,
  p100k BIGINT DEFAULT 0,
  p50k BIGINT DEFAULT 0,
  waktu_input TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pesanan_nasabah_tanggal ON pesanan_nasabah(tanggal);
CREATE INDEX idx_pesanan_nasabah_user_estim ON pesanan_nasabah(user_estim);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bon_setor ENABLE ROW LEVEL SECURITY;
ALTER TABLE arsip_bon_setor ENABLE ROW LEVEL SECURITY;
ALTER TABLE posisi_kas ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_awal_ht ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_pegawai ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_pejabat_ht ENABLE ROW LEVEL SECURITY;
ALTER TABLE setting_fonnte ENABLE ROW LEVEL SECURITY;
ALTER TABLE perkiraan_bon_setor ENABLE ROW LEVEL SECURITY;
ALTER TABLE hari_libur ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesanan_nasabah ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to access all tables (backend API handles business logic)
CREATE POLICY "Allow authenticated access" ON users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON bon_setor FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON arsip_bon_setor FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON posisi_kas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON saldo_awal_ht FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON data_pegawai FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON data_pejabat_ht FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON setting_fonnte FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON perkiraan_bon_setor FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON hari_libur FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access" ON pesanan_nasabah FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- SEED DATA
-- =============================================
INSERT INTO users (kode_wilayah, kode_cabang, nama_unit, nama_user, role, user_estim, password)
VALUES ('ALL', 'ALL', 'KANTOR PUSAT', 'admin', 'admin', 'admin_super', 'super');
