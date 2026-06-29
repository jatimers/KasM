-- =============================================
-- MIGRASI: Fix db_tukab.nominal_tukab INTEGER → BIGINT
-- INTEGER max 2,147,483,647 (Rp 2,1M) — overflow utk TUKAB besar
-- BIGINT max 9,223,372,036,854,775,807 (aman)
-- Date: 2026-06-29
-- =============================================

ALTER TABLE db_tukab ALTER COLUMN nominal_tukab TYPE BIGINT;
