-- Migration 015: Ubah kolom posisi_kas dari BIGINT ke NUMERIC(18,2)
-- Agar bisa menyimpan nilai desimal 2 angka (user input Estim Debet/Kredit + hasil kalkulasi)

ALTER TABLE posisi_kas ALTER COLUMN penerimaan_debet TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN penerimaan_antar_teller TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN pembayaran_kredit TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN pembayaran_antar_teller TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN saldo_kemarin TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN saldo_hari_ini TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN saldo_fisik TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN selisih TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN selisih_pembulatan TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN estim_debet TYPE NUMERIC(18,2);
ALTER TABLE posisi_kas ALTER COLUMN estim_kredit TYPE NUMERIC(18,2);
