-- =============================================
-- MIGRASI: Fix pg_cron schedule
-- Reset cron ke UTC (DB timezone tetap UTC)
-- =============================================

-- Hapus schedule lama (jika ada, ignore error)
DO $$ BEGIN
  PERFORM cron.unschedule('daily-laporan-ht');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('daily-perkiraan-h1');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Buat ulang dengan waktu UTC YANG BENAR
-- daily-laporan-ht: 09:00 UTC = 16:00 WIB
SELECT cron.schedule(
  'daily-laporan-ht',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-laporan-ht"}'::jsonb
  )
  $$
);

-- daily-perkiraan-h1: 00:00 UTC = 07:00 WIB
SELECT cron.schedule(
  'daily-perkiraan-h1',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-perkiraan-h1"}'::jsonb
  )
  $$
);
