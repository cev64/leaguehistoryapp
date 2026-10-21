-- The clubhouse's notifications, every hour: pg_cron calls the
-- clubhouse-push function (supabase/functions/clubhouse-push), which works
-- out what's due (the Tuesday recap, Thursday's pick'em reminder, the
-- week's awards) and sends it. Calling it when nothing is due costs a few
-- small reads, and nothing goes twice (push_sends), so hourly is plenty.
--
-- Run this LAST, once the function is deployed and its secrets are set
-- (README ▸ The clubhouse). Until then there's nothing to call.
--
-- 1. Supabase ▸ Database ▸ Extensions: turn on pg_cron and pg_net (or let
--    the two lines below do it).
-- 2. Keep the function's address and its secret in Vault, once, in the SQL
--    editor (the secret is the same CLUBHOUSE_PUSH_SECRET given to
--    `supabase secrets set`; the project URL is Settings ▸ API ▸ Project URL):
--
--      select vault.create_secret('https://<project-ref>.supabase.co', 'clubhouse_push_url');
--      select vault.create_secret('<CLUBHOUSE_PUSH_SECRET>', 'clubhouse_push_secret');
--
--    To change one later: select vault.update_secret(id, '<new value>')
--    with the id from `select id, name from vault.secrets;`.
-- 3. Paste this file into the SQL editor. Safe to run again (the job is
--    named, so it's replaced, not doubled).
--
-- To see it working:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'clubhouse-push')
--    order by start_time desc limit 10;
--   select id, status_code, left(content, 400), created from net._http_response order by created desc limit 10;
--   (the function's own report, also in Supabase ▸ Edge Functions ▸ clubhouse-push ▸ Logs)
-- To try it by hand without sending anything:
--   curl -X POST -H "x-clubhouse-secret: $SECRET" \
--     "https://<project-ref>.supabase.co/functions/v1/clubhouse-push?dry=1"
-- To turn it off:
--   select cron.unschedule('clubhouse-push');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Five past every hour: Tuesday 9:05 AM Eastern for the recap, about four
-- hours before Thursday's kickoff for the reminder, the hour after it for
-- the awards.
select cron.schedule(
  'clubhouse-push',
  '5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'clubhouse_push_url')
             || '/functions/v1/clubhouse-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-clubhouse-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'clubhouse_push_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
