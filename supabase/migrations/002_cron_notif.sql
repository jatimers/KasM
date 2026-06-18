-- =============================================
-- MIGRASI: Scheduled WA Notifications (pg_cron)
-- Pengganti GAS ScriptApp.newTrigger()
-- STATUS: AKTIF — dijalankan 2026-06-18
-- =============================================

-- Enable pg_cron extension (requires Supabase Pro/Team plan)
-- Jika pg_cron tidak tersedia, gunakan alternative: GitHub Actions scheduled workflow
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily Laporan HT (jam 16:00 WIB = 09:00 UTC)
-- Ini menggantikan dailyFonnteTask() di GAS
SELECT cron.schedule(
  'daily-laporan-ht',
  '0 9 * * *',  -- 16:00 WIB
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-laporan-ht"}'::jsonb
  )
  $$
);

-- Schedule daily Summary Perkiraan H-1 (jam 07:00 WIB = 00:00 UTC)
-- Ini menggantikan dailyPerkiraanH1Task() di GAS
SELECT cron.schedule(
  'daily-perkiraan-h1',
  '0 0 * * *',  -- 07:00 WIB
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-perkiraan-h1"}'::jsonb
  )
  $$
);
