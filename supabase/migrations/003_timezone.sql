-- =============================================
-- MIGRASI: Set timezone database ke Asia/Jakarta (GMT+7 / WIB)
-- Jalankan di SQL Editor Supabase Dashboard
-- =============================================

-- Set timezone database (mempengaruhi NOW(), CURRENT_TIMESTAMP, dll)
ALTER DATABASE postgres SET timezone TO 'Asia/Jakarta';

-- Update pg_cron: unschedule yg lama (UTC) dan buat ulang (WIB)
SELECT cron.unschedule('daily-laporan-ht');
SELECT cron.unschedule('daily-perkiraan-h1');

-- 16:00 WIB = kirim Laporan HT harian
SELECT cron.schedule(
  'daily-laporan-ht',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-laporan-ht"}'::jsonb
  )
  $$
);

-- 07:00 WIB = kirim Summary Perkiraan H-1
SELECT cron.schedule(
  'daily-perkiraan-h1',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url:='https://jwsfsczgyqphoyflpjnm.supabase.co/functions/v1/notif-fonnte',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3c2ZzY3pneXFwaG95Zmxwam5tIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYwMzQyNiwiZXhwIjoyMDk3MTc5NDI2fQ.wCkj-LN8oeL4TeEAYUaNk4zzV5SMeeDiF8LkZmoXXv8"}'::jsonb,
    body:='{"action":"scheduled-perkiraan-h1"}'::jsonb
  )
  $$
);
