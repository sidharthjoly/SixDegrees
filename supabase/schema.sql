-- Six Degrees of Justin Timberlake: daily results (for "Beat 72% of players" and the day's
-- global stats) and group leaderboards. Safe to run again: it only creates what is missing,
-- brings older versions' tables up to date, and replaces the functions.
--
-- Everything lives in the sixdegrees schema, which the Data API doesn't expose. The site can
-- only call the public.sixdegrees_* functions below, and each of them touches this schema
-- and nothing else. So this can share a Supabase project with another app without either
-- app's visitors being able to read or change the other's data.
--
-- There are no accounts. A player is a random id kept in their browser, which only ever goes
-- in, never out: no function returns anyone's id, so nobody can play or leave a group as
-- someone else. Results carry no names; a name is only stored when a player joins a group.
--
-- Anyone can make up player ids, so nothing can be limited per player. The functions that
-- add rows (results, hints, groups, joins, new codes) are only open to the site's Cloudflare Worker
-- (src/gate.ts), which holds a secret key and passes keys for the connection each call came
-- from, made from its IP address (never the address itself): one for the address (an IPv6
-- one's /64) and a wider one (an IPv6 address's /48; the same as the first for IPv4). Each of
-- those writes counts toward daily caps for both and one for everyone, and writes stop once these
-- tables reach their storage budget (see sixdegrees.take). A free project that runs out of
-- space turns read-only for every app in it, not just this one. Results are only kept for
-- the week group boards look back over, and members who stop playing drop off (see
-- sixdegrees.tidy, run nightly at the end of this file), so junk ages out on its own.
--
-- What a result says is checked too, as far as a game that runs in the browser allows. The
-- Worker checks its route against the game's data (src/route-check.ts). Whether it was played
-- on the day is decided here, by when it arrives and where the player's day is (see
-- sixdegrees.player_day), not by what the browser says. And a daily's hints come from the
-- Worker, recorded here (sixdegrees_hint), so a result counts every hint its player asked for.

create schema if not exists sixdegrees;
revoke all on schema sixdegrees from public;

create table if not exists sixdegrees.results (
  client uuid not null,
  day date not null,
  -- The star daily is the day's start heading for one of the other stars instead of JT.
  mode text not null check (mode in ('normal', 'hard', 'star')),
  -- Films played; giving up straight away is 0.
  films smallint not null check (films between 0 and 200),
  hints smallint not null default 0 check (hints >= 0 and hints <= films),
  par smallint not null check (par between 1 and 20),
  gave_up boolean not null,
  -- Arrived after the daily's own day was over where the player is (sixdegrees.player_day):
  -- played from the archive, or sent late. Counts for neither groups nor the day's stats.
  late boolean not null default false,
  first_film integer check (first_film > 0),
  -- The route as film-person pairs in base36, like a challenge link; finished games only.
  route text,
  played_at timestamptz not null default now(),
  primary key (client, day, mode),
  -- Nobody finishes in fewer films than par.
  check (gave_up or films >= par)
);
create index if not exists results_day_idx on sixdegrees.results (day, mode);

-- A pair is at most 13 characters, so 200 is a route of 15-odd films, beyond which nobody
-- shares a route anyway; longer ones are kept without it (sixdegrees_submit). The cap keeps a
-- day of junk results near 17 MB. Replaced rather than created so a rerun updates it, after
-- dropping any route stored under an older, longer cap.
update sixdegrees.results set route = null where length(route) > 200;
alter table sixdegrees.results drop constraint if exists results_route_check;
alter table sixdegrees.results add constraint results_route_check
  check (length(route) <= 200 and route ~ '^[0-9a-z]+-[0-9a-z]+(_[0-9a-z]+-[0-9a-z]+)*$');

-- The star daily came after the table, so a rerun swaps whatever mode check the table has
-- (found by what it checks, not by name) for the one above.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'sixdegrees.results'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%mode%'
  loop
    execute format('alter table sixdegrees.results drop constraint %I', c.conname);
  end loop;
end $$;
alter table sixdegrees.results add constraint results_mode_check check (mode in ('normal', 'hard', 'star'));

-- A day's global stats, kept once its results have gone (sixdegrees.tidy), so past dailies
-- still show how everyone did.
create table if not exists sixdegrees.day_totals (
  day date not null,
  mode text not null,
  totals jsonb not null,
  primary key (day, mode)
);

create table if not exists sixdegrees.groups (
  code text primary key,
  name text not null,
  -- Whoever started the group, who can remove members and replace the code. It passes to
  -- the longest-standing member when they leave.
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists sixdegrees.members (
  code text not null references sixdegrees.groups (code) on update cascade on delete cascade,
  client uuid not null,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (code, client)
);
create index if not exists members_client_idx on sixdegrees.members (client);

-- What the group's starter removes a member by, since player ids never come out.
alter table sixdegrees.members add column if not exists id bigint generated always as identity;

-- When the member last sent a result, from any group: members who stop playing drop off
-- (sixdegrees.tidy). Filled in from the results still kept the first time this runs.
alter table sixdegrees.members add column if not exists played_at timestamptz;
update sixdegrees.members m set played_at = (select max(r.played_at) from sixdegrees.results r where r.client = m.client)
where m.played_at is null;

-- Codes can be replaced (sixdegrees_new_code) and members follow. Tables made before that
-- lack the cascade, so the key is replaced rather than created.
alter table sixdegrees.members drop constraint if exists members_code_fkey;
alter table sixdegrees.members add constraint members_code_fkey
  foreign key (code) references sixdegrees.groups (code) on update cascade on delete cascade;

-- A name as it reads, for telling apart names that only look different: compatibility forms
-- (fullwidth, styled letters) and accents dropped, along with spaces and the punctuation names
-- may have; Cyrillic, Greek, Armenian and small-capital letters that pass for Latin ones made
-- Latin, as are 0 and 1; capital I, which reads as a small L, made one; "rn" made "m" and
-- "vv" "w"; then lower case. Lower-case i and l stay apart ("Bill", "Bili"), so a name and its
-- other cases are kept apart by lower() instead (see members_name_key). Not every look-alike
-- in Unicode, but the ones a name can be faked with in practice.
create or replace function sixdegrees.name_key(name text) returns text
language sql immutable set search_path = '' as $$
  select lower(replace(replace(translate(
    regexp_replace(normalize(name, NFKD), E'[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F\u00B7\u2019'' .-]', '', 'g'),
    E'I\u0131\u0237\u0251\u0269\u0261\u00F8\u00D8\u0111\u0110\u0142\u0141\u0127\u012601\u0410\u0412\u0415\u0405\u0406\u0408\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0423\u0425\u04AE\u051A\u051C\u04C0\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0455\u0456\u0458\u0501\u051B\u051D\u04BB\u04CF\u04AF\u0475\u0391\u0392\u0395\u0396\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A5\u03A7\u03B1\u03B9\u03BA\u03BD\u03BF\u03C1\u03C5\u03C2\u03F3\u0585\u057D\u0570\u0578\u1D00\u0299\u1D04\u1D05\u1D07\u0262\u029C\u026A\u1D0A\u1D0B\u029F\u1D0D\u0274\u1D0F\u1D18\u0280\uA731\u1D1B\u1D1C\u1D20\u1D21\u028F\u1D22',
    'lijaigoOdDlLhHolABESlJKMHOPCTYXYQWlaeopcyxsijdqwhlyvABEZHlKMNOPTYXaikvopucjouhnabcdeghljklmnoprstuvwyz'),
    'rn', 'm'), 'vv', 'w'))
$$;

-- One of each name per group: not the same whatever the case (members_name_key), nor a
-- look-alike (members_look_key), so nobody can pass for another member. Names stored before
-- that are put in the same form sixdegrees.clean_name gives, and any that clash with an
-- earlier member's get a number ("Sam 2") before the indexes go on. The look-alike index is
-- rebuilt each run, since name_key may have changed.
update sixdegrees.members set name = normalize(name, NFC) where name is not nfc normalized;
do $$
declare
  m record;
  n int;
  fresh text;
begin
  for m in select code, client, name, joined_at from sixdegrees.members order by code, joined_at, client loop
    continue when not exists (
      select 1 from sixdegrees.members o
      where o.code = m.code and (o.joined_at, o.client) < (m.joined_at, m.client)
        and (lower(o.name) = lower(m.name) or sixdegrees.name_key(o.name) = sixdegrees.name_key(m.name))
    );
    n := 2;
    loop
      fresh := rtrim(left(m.name, 19 - length(n::text))) || ' ' || n;
      exit when not exists (
        select 1 from sixdegrees.members o
        where o.code = m.code and o.client <> m.client
          and (lower(o.name) = lower(fresh) or sixdegrees.name_key(o.name) = sixdegrees.name_key(fresh))
      );
      n := n + 1;
    end loop;
    update sixdegrees.members set name = fresh where code = m.code and client = m.client;
  end loop;
end $$;
create unique index if not exists members_name_key on sixdegrees.members (code, lower(name));
create unique index if not exists members_look_key on sixdegrees.members (code, sixdegrees.name_key(name));
reindex index sixdegrees.members_look_key;

-- Writes so far each UTC day, by kind, for everyone and for each connection (see
-- sixdegrees.take). The connection key is the Worker's; no address is stored.
create table if not exists sixdegrees.quota (
  day date not null,
  kind text not null,
  n int not null,
  primary key (day, kind)
);
create table if not exists sixdegrees.source_quota (
  day date not null,
  kind text not null,
  source text not null,
  n int not null,
  primary key (day, kind, source)
);

-- Where each player's day is (see sixdegrees.player_day): their device's offset from UTC
-- in minutes, and the latest date they've reached by any offset they've had. A row is made
-- by a player's first result or group, and goes after 90 days without either.
create table if not exists sixdegrees.players (
  client uuid primary key,
  -- Null until a device has said (for players from before offsets were sent).
  utc_offset int check (utc_offset between -720 and 840),
  reached date not null,
  seen_at timestamptz not null default now()
);
-- Players with results from before this table: they've reached at least their latest daily.
insert into sixdegrees.players (client, utc_offset, reached)
select client, null, max(day) from sixdegrees.results group by client
on conflict (client) do nothing;

-- The places in a daily where each player asked for a hint (sixdegrees_hint). Asking again in
-- the same place (after an undo) counts once.
create table if not exists sixdegrees.hints (
  client uuid not null,
  day date not null,
  mode text not null,
  person int not null,
  primary key (client, day, mode, person)
);

-- No policies: nothing reaches these tables except through the functions below.
alter table sixdegrees.results enable row level security;
alter table sixdegrees.day_totals enable row level security;
alter table sixdegrees.groups enable row level security;
alter table sixdegrees.members enable row level security;
alter table sixdegrees.quota enable row level security;
alter table sixdegrees.source_quota enable row level security;
alter table sixdegrees.players enable row level security;
alter table sixdegrees.hints enable row level security;

-- The first daily. Nothing before it is a real result.
create or replace function sixdegrees.first_day() returns date
language sql immutable set search_path = '' as $$ select date '2026-10-08' $$;

-- Whether `p_day` is the player's own day as of `p_at`, by their device's offset from UTC
-- (`p_offset`, minutes), and not a date they've already left behind; remembers the offset and
-- how far they've got. Without `p_day` it just remembers (null). A daily counts only on its own
-- day (sixdegrees_submit), so this is what stops yesterday's daily counting today: the time
-- comes from the server's clock, and turning the device's clock or zone back (or flying west)
-- can't return to a date already reached under the old one. Flying east just moves on, and
-- someone flying west waits out the repeated hours. For two minutes after midnight both days
-- count, so a game finished just before still arrives in time, and one started right after
-- isn't held back. With no offset (an old copy of the game) the one on file is used, or the
-- day can't be known and nothing counts. `p_at` is for tests; the functions use now().
create or replace function sixdegrees.player_day(p_client uuid, p_offset int, p_day date default null, p_at timestamptz default now())
returns boolean
language plpgsql set search_path = '' as $$
declare
  graced timestamp := (p_at - interval '2 minutes') at time zone 'utc';
  utc timestamp := p_at at time zone 'utc';
  p sixdegrees.players;
  off int;
  passed date;
  today date;
begin
  if p_offset is not null and (p_offset not between -720 and 840 or p_offset % 15 <> 0) then
    raise exception 'That isn’t a time zone' using errcode = '22023';
  end if;
  select * into p from sixdegrees.players where client = p_client for update;
  off := coalesce(p_offset, p.utc_offset);
  if off is null then
    return case when p_day is not null then false end;
  end if;
  -- The date two minutes ago is what's remembered, so a call in the grace (a rename, say) can't
  -- close the old day early.
  today := (graced + make_interval(mins => off))::date;
  passed := case when p.client is null then today
                 else greatest(p.reached, (graced + make_interval(mins => coalesce(p.utc_offset, off)))::date) end;
  insert into sixdegrees.players as x (client, utc_offset, reached, seen_at) values (p_client, off, greatest(passed, today), p_at)
  on conflict (client) do update set utc_offset = excluded.utc_offset, reached = excluded.reached, seen_at = excluded.seen_at;
  if p_day is null then
    return null;
  end if;
  return today >= passed and p_day in (today, (utc + make_interval(mins => off))::date);
end $$;

-- Counts one write of `p_kind` from the connection keys `p_source` and `p_wide`, and raises if
-- that's more than `p_source_cap` today from the one, or `p_wide_cap` from the other, or more
-- than `p_cap` today from everyone (with `p_busy`), or if this schema's tables have outgrown
-- their 200 MB budget (the free plan's database is 500 MB, shared). A raise undoes the counts
-- along with the write. The connection caps leave room for many players behind one address
-- (a phone network's shared IPv4), and mean running everyone's cap down takes hundreds of
-- addresses, not one script. At the caps for everyone, a day of junk adds about 20 MB; the
-- results, most of it, go after a week.
drop function if exists sixdegrees.take(text, int, text);
create or replace function sixdegrees.take(p_kind text, p_cap int, p_busy text, p_source text, p_source_cap int, p_wide text, p_wide_cap int) returns void
language plpgsql set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
  used int;
begin
  if pg_total_relation_size('sixdegrees.results') + pg_total_relation_size('sixdegrees.day_totals')
     + pg_total_relation_size('sixdegrees.groups') + pg_total_relation_size('sixdegrees.members')
     + pg_total_relation_size('sixdegrees.quota') + pg_total_relation_size('sixdegrees.source_quota')
     + pg_total_relation_size('sixdegrees.players') + pg_total_relation_size('sixdegrees.hints') > 200 * 1024 * 1024 then
    raise exception 'The game’s server is full' using errcode = '53100';
  end if;
  insert into sixdegrees.source_quota as q (day, kind, source, n) values (today, p_kind, coalesce(p_source, ''), 1)
  on conflict (day, kind, source) do update set n = q.n + 1
  returning n into used;
  if used > p_source_cap then
    raise exception 'That’s a lot from your connection today. Try again tomorrow.' using errcode = '54000';
  end if;
  insert into sixdegrees.source_quota as q (day, kind, source, n) values (today, p_kind || ':wide', coalesce(p_wide, ''), 1)
  on conflict (day, kind, source) do update set n = q.n + 1
  returning n into used;
  if used > p_wide_cap then
    raise exception 'That’s a lot from your connection today. Try again tomorrow.' using errcode = '54000';
  end if;
  insert into sixdegrees.quota as q (day, kind, n) values (today, p_kind, 1)
  on conflict (day, kind) do update set n = q.n + 1
  returning n into used;
  if used > p_cap then
    raise exception '%', p_busy using errcode = '54000';
  end if;
end $$;

-- A display name: in NFC like the game's own, no control or invisible characters (zero-width
-- spaces, the bidi overrides that make text read backwards), at most two combining accents in
-- a row, spaces collapsed, at most `max` characters. The game cleans names before sending them,
-- and the Worker only passes player names the game would make, but this is the last word.
-- Raises if nothing is left.
create or replace function sixdegrees.clean_name(raw text, max int) returns text
language plpgsql immutable set search_path = '' as $$
declare
  marks constant text := E'\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F';
  name text := normalize(left(coalesce(raw, ''), 200), NFC);
begin
  name := regexp_replace(name, E'[[:cntrl:]\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]', '', 'g');
  name := regexp_replace(name, '([' || marks || ']{2})[' || marks || ']+', '\1', 'g');
  name := btrim(left(btrim(regexp_replace(name, '\s+', ' ', 'g')), max));
  if name = '' then
    raise exception 'A name is needed' using errcode = '22023';
  end if;
  return name;
end $$;

-- Lower is better: finished before gave up, then fewer films, then fewer hints. Everyone who
-- gave up ties.
create or replace function sixdegrees.rank_key(gave_up boolean, films int, hints int) returns int[]
language sql immutable set search_path = '' as $$
  select case when gave_up then array[1, 0, 0] else array[0, films, hints] end
$$;

-- A day's global stats from its results: only those played on the day itself count.
create or replace function sixdegrees.totals(p_day date, p_mode text) returns jsonb
language sql stable set search_path = '' as $$
  with r as (
    select * from sixdegrees.results where day = p_day and mode = p_mode and not late
  ),
  opener as (
    select first_film, count(*) as n from r where first_film is not null
    group by first_film order by count(*) desc, first_film limit 1
  )
  select jsonb_build_object(
    'players', (select count(*) from r),
    'atPar', (select count(*) from r where not gave_up and films = par),
    'gaveUp', (select count(*) from r where gave_up),
    'films', (select coalesce(jsonb_object_agg(films, n), '{}'::jsonb)
              from (select films, count(*) as n from r where not gave_up group by films) f),
    'opener', (select jsonb_build_object('film', first_film, 'players', n) from opener)
  )
$$;

-- A fresh group code: 10 characters from two random UUIDs' bytes, about 49 bits, too many to
-- guess. No 0/o, 1/l/i: codes get read out and typed.
create or replace function sixdegrees.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  bytes bytea;
  fresh text;
begin
  loop
    bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    fresh := '';
    for i in 0..9 loop
      fresh := fresh || substr(alphabet, get_byte(bytes, i) % length(alphabet) + 1, 1);
    end loop;
    exit when not exists (select 1 from sixdegrees.groups where code = fresh);
  end loop;
  return fresh;
end $$;

-- Run nightly (see the end of this file).
--   Results: group boards look back seven days from a player's own date, which can be a day
--     behind UTC, so older ones go. Their days' global stats are kept first.
--   Members: anyone who hasn't sent a result in 90 days, or in the 14 days since joining,
--     drops off (they can rejoin with the link). Groups left empty go, and one whose starter
--     dropped off passes to whoever has been in longest.
--   Hints go with their days' results, and players with nothing for 90 days are forgotten.
--   Counts in the quotas from before today go.
create or replace function sixdegrees.tidy() returns void
language plpgsql set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  -- A day's first tidy sees all its results; later ones only see late plays, which don't count.
  insert into sixdegrees.day_totals (day, mode, totals)
  select d.day, d.mode, sixdegrees.totals(d.day, d.mode)
  from (select distinct day, mode from sixdegrees.results where day < today - 7) d
  on conflict (day, mode) do nothing;
  delete from sixdegrees.results where day < today - 7;

  delete from sixdegrees.members
  where played_at < now() - interval '90 days'
     or (played_at is null and joined_at < now() - interval '14 days');
  delete from sixdegrees.groups g where not exists (select 1 from sixdegrees.members m where m.code = g.code);
  update sixdegrees.groups g
  set created_by = (select m.client from sixdegrees.members m where m.code = g.code order by m.joined_at, m.id limit 1)
  where not exists (select 1 from sixdegrees.members m where m.code = g.code and m.client = g.created_by);

  delete from sixdegrees.hints where day < today - 7;
  delete from sixdegrees.players where seen_at < now() - interval '90 days';
  delete from sixdegrees.quota where day < today;
  delete from sixdegrees.source_quota where day < today;
end $$;

-- ------------------------------------------------------------------ results

-- `p_source` and `p_wide` are the Worker's keys for the connection (see the top of this file),
-- and `p_offset` the device's offset from UTC in minutes. Whether the result is late is decided
-- here (sixdegrees.player_day): `p_late`, what the game thought, is ignored. Its hints are as
-- many places as the player asked the Worker for one (sixdegrees_hint), or more if the game
-- says so. Returns whether the player's result for that daily counted as late.
drop function if exists public.sixdegrees_submit(uuid, date, text, int, int, int, boolean, boolean, int, text);
create or replace function public.sixdegrees_submit(
  p_client uuid, p_day date, p_mode text, p_films int, p_hints int, p_par int,
  p_gave_up boolean, p_late boolean, p_first_film int, p_route text, p_source text, p_wide text, p_offset int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
  is_late boolean;
  asked int;
begin
  -- Local dates run from UTC-12 to UTC+14, so "today" somewhere is yesterday to tomorrow in UTC.
  if p_day < sixdegrees.first_day() or p_day > today + 1 then
    raise exception 'No daily on %', p_day using errcode = '22023';
  end if;
  is_late := not coalesce(sixdegrees.player_day(p_client, p_offset, p_day), false);
  asked := (select count(*) from sixdegrees.hints h where h.client = p_client and h.day = p_day and h.mode = p_mode);
  insert into sixdegrees.results (client, day, mode, films, hints, par, gave_up, late, first_film, route)
  values (
    p_client, p_day, p_mode, p_films, least(greatest(coalesce(p_hints, 0), asked), p_films), p_par, p_gave_up,
    is_late,
    p_first_film,
    case when p_gave_up or length(p_route) > 200 then null else nullif(p_route, '') end
  )
  -- A daily counts once per player: their first go.
  on conflict (client, day, mode) do nothing;
  -- Only a new row counts; resending one that's already in costs nothing.
  if found then
    perform sixdegrees.take('results', 50000, 'Too many results today. Try again tomorrow.', p_source, 300, p_wide, 3000);
    update sixdegrees.members set played_at = now() where client = p_client;
  end if;
  return jsonb_build_object('late', (select r.late from sixdegrees.results r where r.client = p_client and r.day = p_day and r.mode = p_mode));
end $$;

-- A hint in a daily (normal, or the star daily): records that the player asked at `p_person`
-- (once per place), so their result counts it whatever the game reports. The Worker answers
-- with the hint itself, from the game's data, only once this has gone through. Hard mode has
-- no hints.
create or replace function public.sixdegrees_hint(p_client uuid, p_day date, p_mode text, p_person int, p_source text, p_wide text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  if p_mode is null or p_mode not in ('normal', 'star') then
    raise exception 'Hard mode has no hints' using errcode = '22023';
  end if;
  if p_day < sixdegrees.first_day() or p_day > today + 1 then
    raise exception 'No daily on %', p_day using errcode = '22023';
  end if;
  insert into sixdegrees.hints (client, day, mode, person) values (p_client, p_day, p_mode, p_person)
  on conflict do nothing;
  if found then
    perform sixdegrees.take('hints', 50000, 'Lots of hints today. Try again tomorrow.', p_source, 300, p_wide, 3000);
  end if;
end $$;

-- The day's global stats, and where `p_client` stands among them. Only results played on the
-- day itself count. Days past a week old answer from their kept totals, without a standing.
create or replace function public.sixdegrees_day(p_day date, p_mode text, p_client uuid default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select * from sixdegrees.results where day = p_day and mode = p_mode and not late
  ),
  me as (select * from r where client = p_client)
  select coalesce(
    (select totals from sixdegrees.day_totals where day = p_day and mode = p_mode),
    sixdegrees.totals(p_day, p_mode)
  ) || jsonb_build_object(
    'me', (
      select jsonb_build_object(
        'beat', (select count(*) from r
                 where sixdegrees.rank_key(r.gave_up, r.films, r.hints) > sixdegrees.rank_key(m.gave_up, m.films, m.hints)),
        'sameOpener', (select count(*) from r where r.client <> m.client and r.first_film = m.first_film),
        'sameRoute', (select count(*) from r where r.client <> m.client and r.route = m.route)
      )
      from me m
    )
  )
$$;

-- ------------------------------------------------------------------ groups

drop function if exists public.sixdegrees_create_group(uuid, text, text);
-- `p_offset`, as for sixdegrees_submit, starts the player's record of where their day is before
-- they have a result on a group's board.
create or replace function public.sixdegrees_create_group(p_client uuid, p_group_name text, p_player_name text, p_source text, p_wide text, p_offset int)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  new_code text;
  group_name text := sixdegrees.clean_name(p_group_name, 40);
  player_name text := sixdegrees.clean_name(p_player_name, 20);
begin
  if (select count(*) from sixdegrees.groups where created_by = p_client and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of new groups. Try again tomorrow.' using errcode = '54000';
  end if;
  perform sixdegrees.take('groups', 2000, 'Lots of new groups today. Try again tomorrow.', p_source, 20, p_wide, 200);
  perform sixdegrees.player_day(p_client, p_offset);
  new_code := sixdegrees.new_code();
  insert into sixdegrees.groups (code, name, created_by) values (new_code, group_name, p_client);
  insert into sixdegrees.members (code, client, name) values (new_code, p_client, player_name);
  return new_code;
end $$;

-- Join, or change your name in a group you're already in. `p_offset` as for create_group.
drop function if exists public.sixdegrees_join_group(text, uuid, text);
create or replace function public.sixdegrees_join_group(p_code text, p_client uuid, p_player_name text, p_source text, p_wide text, p_offset int)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g sixdegrees.groups;
  player_name text := sixdegrees.clean_name(p_player_name, 20);
begin
  select * into g from sixdegrees.groups where code = lower(p_code);
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if not exists (select 1 from sixdegrees.members where code = g.code and client = p_client)
     and (select count(*) from sixdegrees.members where code = g.code) >= 100 then
    raise exception 'That group is full' using errcode = '54000';
  end if;
  perform sixdegrees.take('joins', 10000, 'Lots of joining today. Try again tomorrow.', p_source, 100, p_wide, 1000);
  perform sixdegrees.player_day(p_client, p_offset);
  begin
    insert into sixdegrees.members (code, client, name) values (g.code, p_client, player_name)
    on conflict (code, client) do update set name = excluded.name;
  exception when unique_violation then
    raise exception 'Someone in this group already has that name, or one that looks like it. Try another.' using errcode = '23505';
  end;
  return jsonb_build_object('code', g.code, 'name', g.name);
end $$;

-- The last one out takes the group with them. If the group's starter leaves, whoever has been
-- in longest takes over.
create or replace function public.sixdegrees_leave_group(p_code text, p_client uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from sixdegrees.members where code = lower(p_code) and client = p_client;
  delete from sixdegrees.groups g where g.code = lower(p_code)
    and not exists (select 1 from sixdegrees.members m where m.code = g.code);
  update sixdegrees.groups g
  set created_by = (select m.client from sixdegrees.members m where m.code = g.code order by m.joined_at, m.id limit 1)
  where g.code = lower(p_code) and g.created_by = p_client;
end $$;

-- The group's starter takes someone off the board. They can rejoin with the invite link
-- until the starter replaces it (sixdegrees_new_code).
create or replace function public.sixdegrees_remove_member(p_code text, p_client uuid, p_member bigint)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from sixdegrees.groups where code = lower(p_code) and created_by = p_client) then
    raise exception 'Only whoever started the group can remove people';
  end if;
  delete from sixdegrees.members where code = lower(p_code) and id = p_member and client <> p_client;
end $$;

-- The group's starter swaps its code for a new one, so an invite link that got out stops
-- working. Everyone already in stays in. Returns the new code.
drop function if exists public.sixdegrees_new_code(text, uuid);
create or replace function public.sixdegrees_new_code(p_code text, p_client uuid, p_source text, p_wide text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  fresh text;
begin
  if not exists (select 1 from sixdegrees.groups where code = lower(p_code) and created_by = p_client) then
    raise exception 'Only whoever started the group can replace its link';
  end if;
  perform sixdegrees.take('codes', 2000, 'Lots of new links today. Try again tomorrow.', p_source, 20, p_wide, 200);
  fresh := sixdegrees.new_code();
  update sixdegrees.groups set code = fresh where code = lower(p_code);
  return fresh;
end $$;

-- A group's board: each member's result for `p_day` in each mode, and their week (the seven
-- days to `p_day`). A week's points per day: 3 for par, 2 for one over, 1 for two over, none
-- otherwise, from the JT daily or the star daily, whichever went better, so playing both
-- never counts twice. Hard mode is extra. Anyone with the code can look; `member` says whether p_client is in,
-- and `owner` whether they started it. Each member's `id` is only for removing them.
create or replace function public.sixdegrees_group(p_code text, p_client uuid, p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with g as (select * from sixdegrees.groups where code = lower(p_code)),
  m as (select mem.* from sixdegrees.members mem join g on g.code = mem.code),
  res as (
    select r.* from sixdegrees.results r join m on m.client = r.client
    where r.day between p_day - 6 and p_day and not r.late
  )
  select case when not exists (select 1 from g) then null else jsonb_build_object(
    'code', (select code from g),
    'name', (select name from g),
    'member', exists (select 1 from m where client = p_client),
    'owner', exists (select 1 from g where created_by = p_client),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'me', m.client = p_client,
        'normal', (select jsonb_build_object('films', films, 'hints', hints, 'par', par, 'gaveUp', gave_up)
                   from res where res.client = m.client and res.day = p_day and res.mode = 'normal'),
        'hard', (select jsonb_build_object('films', films, 'hints', hints, 'par', par, 'gaveUp', gave_up)
                 from res where res.client = m.client and res.day = p_day and res.mode = 'hard'),
        'star', (select jsonb_build_object('films', films, 'hints', hints, 'par', par, 'gaveUp', gave_up)
                 from res where res.client = m.client and res.day = p_day and res.mode = 'star'),
        'week', (select jsonb_build_object('played', count(*), 'points', coalesce(sum(d.points), 0))
                 from (select max(case when gave_up then 0 else greatest(0, 3 - (films - par)) end) as points
                       from res where res.client = m.client and res.mode in ('normal', 'star')
                       group by res.day) d)
      ) order by m.joined_at), '[]'::jsonb)
      from m
    )
  ) end
$$;

-- The groups a player is in, for the home page.
create or replace function public.sixdegrees_my_groups(p_client uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', g.code,
    'name', g.name,
    'members', (select count(*) from sixdegrees.members x where x.code = g.code)
  ) order by m.joined_at), '[]'::jsonb)
  from sixdegrees.members m join sixdegrees.groups g on g.code = m.code
  where m.client = p_client
$$;

-- Who can call what. Supabase grants new functions in public to anon, authenticated and
-- service_role directly, not just through PUBLIC, so each is revoked by name. The helpers stay
-- internal. Reading, leaving and removing members are open to the site's visitors (anon) and
-- signed-in users alike. Writes that add rows are only for the Worker's secret key
-- (service_role), which passes the connection key they're counted by.
revoke all on all functions in schema sixdegrees from public, anon, authenticated, service_role;
revoke all on function
  public.sixdegrees_submit(uuid, date, text, int, int, int, boolean, boolean, int, text, text, text, int),
  public.sixdegrees_hint(uuid, date, text, int, text, text),
  public.sixdegrees_create_group(uuid, text, text, text, text, int),
  public.sixdegrees_join_group(text, uuid, text, text, text, int),
  public.sixdegrees_new_code(text, uuid, text, text)
from public, anon, authenticated;
grant execute on function
  public.sixdegrees_submit(uuid, date, text, int, int, int, boolean, boolean, int, text, text, text, int),
  public.sixdegrees_hint(uuid, date, text, int, text, text),
  public.sixdegrees_create_group(uuid, text, text, text, text, int),
  public.sixdegrees_join_group(text, uuid, text, text, text, int),
  public.sixdegrees_new_code(text, uuid, text, text)
to service_role;
revoke all on function
  public.sixdegrees_day(date, text, uuid),
  public.sixdegrees_leave_group(text, uuid),
  public.sixdegrees_remove_member(text, uuid, bigint),
  public.sixdegrees_group(text, uuid, date),
  public.sixdegrees_my_groups(uuid)
from public;
grant execute on function
  public.sixdegrees_day(date, text, uuid),
  public.sixdegrees_leave_group(text, uuid),
  public.sixdegrees_remove_member(text, uuid, bigint),
  public.sixdegrees_group(text, uuid, date),
  public.sixdegrees_my_groups(uuid)
to anon, authenticated;

-- ------------------------------------------------------------------ nightly tidy

-- Supabase Cron (pg_cron) runs these each night, UTC. Deleted rows keep their room in the
-- table files, which is what the budget in sixdegrees.take measures, so the second job
-- rewrites the tables to give it back; it's a job of its own because VACUUM can't run inside
-- a function or alongside other statements. Rescheduling a job by name replaces it.
--
-- Supabase gives postgres what it needs for pg_cron itself whenever the extension is created,
-- and that runs again even for "create extension if not exists", where it can fail. So the
-- extension is only created when it's missing.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron with schema pg_catalog;
  end if;
end $$;
select cron.schedule('sixdegrees-tidy', '17 3 * * *', 'select sixdegrees.tidy()');
select cron.schedule('sixdegrees-compact', '27 3 * * *',
  'vacuum full sixdegrees.results, sixdegrees.day_totals, sixdegrees.groups, sixdegrees.members, sixdegrees.quota, sixdegrees.source_quota, sixdegrees.players, sixdegrees.hints');
