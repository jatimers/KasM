-- =============================================
-- MIGRASI: Fix cron → weekday only (Mon-Fri)
-- Hapus duplikat GitHub Actions, pg_cron satu2nya
-- =============================================

-- Hapus semua cron jobs yang ada
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobname FROM cron.job LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- Verifikasi bersih
SELECT COUNT(*) AS remaining_jobs_before FROM cron.job;

-- daily-perkiraan-h1: 00:00 UTC = 07:00 WIB, Senin-Jumat SAJA
SELECT cron.schedule(
  'daily-perkiraan-h1',
  '0 0 * * 1-5',
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-perkiraan-h1"}'::jsonb
  )
  $$
);

-- daily-laporan-ht: 09:00 UTC = 16:00 WIB, Senin-Jumat SAJA
SELECT cron.schedule(
  'daily-laporan-ht',
  '0 9 * * 1-5',
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-laporan-ht"}'::jsonb
  )
  $$
);

-- Verifikasi hasil
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
