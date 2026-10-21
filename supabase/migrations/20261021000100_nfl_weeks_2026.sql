-- The 2026 NFL regular season's first kickoff each week, from the NFL's
-- schedule (ESPN's public scoreboard) as of 2026-10-21: what pick'em locks at
-- and award voting runs on (pick_deadline(), 20261021000000_league_clubhouse.sql).
-- Made by `node tools/nfl-weeks.mjs 2026`; run it again if the NFL moves a
-- week's first game.
--
-- Paste into Supabase ▸ SQL editor after the clubhouse migration. Safe to
-- run again.

insert into public.nfl_weeks (season, week, kickoff) values
  (2026,  1, '2026-09-10T00:20:00.000Z'),
  (2026,  2, '2026-09-18T00:15:00.000Z'),
  (2026,  3, '2026-09-25T00:15:00.000Z'),
  (2026,  4, '2026-10-02T00:15:00.000Z'),
  (2026,  5, '2026-10-09T00:15:00.000Z'),
  (2026,  6, '2026-10-16T00:15:00.000Z'),
  (2026,  7, '2026-10-23T00:15:00.000Z'),
  (2026,  8, '2026-10-30T00:15:00.000Z'),
  (2026,  9, '2026-11-06T01:15:00.000Z'),
  (2026, 10, '2026-11-13T01:15:00.000Z'),
  (2026, 11, '2026-11-20T01:15:00.000Z'),
  (2026, 12, '2026-11-26T01:00:00.000Z'),
  (2026, 13, '2026-12-04T01:15:00.000Z'),
  (2026, 14, '2026-12-11T01:15:00.000Z'),
  (2026, 15, '2026-12-18T01:15:00.000Z'),
  (2026, 16, '2026-12-25T01:15:00.000Z'),
  (2026, 17, '2027-01-01T01:15:00.000Z'),
  (2026, 18, '2027-01-09T18:00:00.000Z')  -- times not set yet: the Saturday before, 1 PM ET, until they are
on conflict (season, week) do update set kickoff = excluded.kickoff;
