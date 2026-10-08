-- Six Degrees of Justin Timberlake: daily results (for "Beat 72% of players" and the day's
-- global stats) and group leaderboards. Safe to run again: it only creates what is missing
-- and replaces the functions.
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
-- Anyone can call these functions in a loop with made-up ids, so nothing can be limited per
-- player. Instead every write counts toward a daily cap for its kind, and writes stop once
-- these tables reach their storage budget (see sixdegrees.take). A free project that runs out
-- of space turns read-only for every app in it, not just this one.

create schema if not exists sixdegrees;
revoke all on schema sixdegrees from public;

create table if not exists sixdegrees.results (
  client uuid not null,
  day date not null,
  mode text not null check (mode in ('normal', 'hard')),
  -- Films played; giving up straight away is 0.
  films smallint not null check (films between 0 and 200),
  hints smallint not null default 0 check (hints >= 0 and hints <= films),
  par smallint not null check (par between 1 and 20),
  gave_up boolean not null,
  -- Played on another day than the daily's own (from the archive). Counts for groups, not
  -- the day's global stats.
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

-- A pair is at most 13 characters, so 600 is a route of 40-odd films; anything longer is kept
-- without its route (sixdegrees_submit). Replaced rather than created so a rerun updates it.
alter table sixdegrees.results drop constraint if exists results_route_check;
alter table sixdegrees.results add constraint results_route_check
  check (length(route) <= 600 and route ~ '^[0-9a-z]+-[0-9a-z]+(_[0-9a-z]+-[0-9a-z]+)*$');

create table if not exists sixdegrees.groups (
  code text primary key,
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists sixdegrees.members (
  code text not null references sixdegrees.groups (code) on delete cascade,
  client uuid not null,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (code, client)
);
create index if not exists members_client_idx on sixdegrees.members (client);

-- Writes so far each UTC day, by kind (see sixdegrees.take).
create table if not exists sixdegrees.quota (
  day date not null,
  kind text not null,
  n int not null,
  primary key (day, kind)
);

-- No policies: nothing reaches these tables except through the functions below.
alter table sixdegrees.results enable row level security;
alter table sixdegrees.groups enable row level security;
alter table sixdegrees.members enable row level security;
alter table sixdegrees.quota enable row level security;

-- The first daily. Nothing before it is a real result.
create or replace function sixdegrees.first_day() returns date
language sql immutable set search_path = '' as $$ select date '2026-10-08' $$;

-- Counts one write of `p_kind`, and raises with `p_busy` if that's more than `p_cap` today, or
-- if this schema's tables have outgrown their 200 MB budget (the free plan's database is
-- 500 MB, shared). A raise undoes the count along with the write. At the caps, a day of junk
-- adds about 40 MB.
create or replace function sixdegrees.take(p_kind text, p_cap int, p_busy text) returns void
language plpgsql set search_path = '' as $$
declare
  used int;
begin
  if pg_total_relation_size('sixdegrees.results') + pg_total_relation_size('sixdegrees.groups')
     + pg_total_relation_size('sixdegrees.members') + pg_total_relation_size('sixdegrees.quota') > 200 * 1024 * 1024 then
    raise exception 'The game’s server is full' using errcode = '53100';
  end if;
  insert into sixdegrees.quota as q (day, kind, n) values ((now() at time zone 'utc')::date, p_kind, 1)
  on conflict (day, kind) do update set n = q.n + 1
  returning n into used;
  if used > p_cap then
    raise exception '%', p_busy using errcode = '54000';
  end if;
end $$;

-- A display name: no control or invisible characters (zero-width spaces, the bidi overrides
-- that make text read backwards), at most two combining accents in a row, spaces collapsed,
-- at most `max` characters. The game cleans names before sending them, but anyone can call
-- these functions directly. Raises if nothing is left.
create or replace function sixdegrees.clean_name(raw text, max int) returns text
language plpgsql immutable set search_path = '' as $$
declare
  marks constant text := E'\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F';
  name text := left(coalesce(raw, ''), 200);
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

-- ------------------------------------------------------------------ results

create or replace function public.sixdegrees_submit(
  p_client uuid, p_day date, p_mode text, p_films int, p_hints int, p_par int,
  p_gave_up boolean, p_late boolean, p_first_film int, p_route text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  -- Local dates run from UTC-12 to UTC+14, so "today" somewhere is yesterday to tomorrow in UTC.
  if p_day < sixdegrees.first_day() or p_day > today + 1 then
    raise exception 'No daily on %', p_day using errcode = '22023';
  end if;
  insert into sixdegrees.results (client, day, mode, films, hints, par, gave_up, late, first_film, route)
  values (
    p_client, p_day, p_mode, p_films, coalesce(p_hints, 0), p_par, p_gave_up,
    coalesce(p_late, false) or p_day < today - 1,
    p_first_film,
    case when p_gave_up or length(p_route) > 600 then null else nullif(p_route, '') end
  )
  -- A daily counts once per player: their first go.
  on conflict (client, day, mode) do nothing;
  -- Only a new row counts; resending one that's already in costs nothing.
  if found then
    perform sixdegrees.take('results', 50000, 'Too many results today. Try again tomorrow.');
  end if;
end $$;

-- The day's global stats, and where `p_client` stands among them. Only results played on the
-- day itself count.
create or replace function public.sixdegrees_day(p_day date, p_mode text, p_client uuid default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select * from sixdegrees.results where day = p_day and mode = p_mode and not late
  ),
  me as (select * from r where client = p_client),
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
    'opener', (select jsonb_build_object('film', first_film, 'players', n) from opener),
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

create or replace function public.sixdegrees_create_group(p_client uuid, p_group_name text, p_player_name text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  -- No 0/o, 1/l/i: codes get read out and typed.
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  bytes bytea;
  new_code text;
  group_name text := sixdegrees.clean_name(p_group_name, 40);
  player_name text := sixdegrees.clean_name(p_player_name, 20);
begin
  if (select count(*) from sixdegrees.groups where created_by = p_client and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of new groups. Try again tomorrow.' using errcode = '54000';
  end if;
  perform sixdegrees.take('groups', 2000, 'Lots of new groups today. Try again tomorrow.');
  loop
    -- 10 characters from two random UUIDs' bytes: about 49 bits, too many to guess.
    bytes := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
    new_code := '';
    for i in 0..9 loop
      new_code := new_code || substr(alphabet, get_byte(bytes, i) % length(alphabet) + 1, 1);
    end loop;
    exit when not exists (select 1 from sixdegrees.groups where code = new_code);
  end loop;
  insert into sixdegrees.groups (code, name, created_by) values (new_code, group_name, p_client);
  insert into sixdegrees.members (code, client, name) values (new_code, p_client, player_name);
  return new_code;
end $$;

-- Join, or change your name in a group you're already in.
create or replace function public.sixdegrees_join_group(p_code text, p_client uuid, p_player_name text)
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
  perform sixdegrees.take('joins', 10000, 'Lots of joining today. Try again tomorrow.');
  insert into sixdegrees.members (code, client, name) values (g.code, p_client, player_name)
  on conflict (code, client) do update set name = excluded.name;
  return jsonb_build_object('code', g.code, 'name', g.name);
end $$;

-- The last one out takes the group with them.
create or replace function public.sixdegrees_leave_group(p_code text, p_client uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from sixdegrees.members where code = lower(p_code) and client = p_client;
  delete from sixdegrees.groups g where g.code = lower(p_code)
    and not exists (select 1 from sixdegrees.members m where m.code = g.code);
end $$;

-- A group's board: each member's result for `p_day` in both modes, and their week (the seven
-- days to `p_day`, normal mode). A week's points per day: 3 for par, 2 for one over, 1 for two
-- over, none otherwise. Anyone with the code can look; `member` says whether p_client is in.
create or replace function public.sixdegrees_group(p_code text, p_client uuid, p_day date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with g as (select * from sixdegrees.groups where code = lower(p_code)),
  m as (select mem.* from sixdegrees.members mem join g on g.code = mem.code),
  res as (
    select r.* from sixdegrees.results r join m on m.client = r.client
    where r.day between p_day - 6 and p_day
  )
  select case when not exists (select 1 from g) then null else jsonb_build_object(
    'code', (select code from g),
    'name', (select name from g),
    'member', exists (select 1 from m where client = p_client),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', m.name,
        'me', m.client = p_client,
        'normal', (select jsonb_build_object('films', films, 'hints', hints, 'par', par, 'gaveUp', gave_up)
                   from res where res.client = m.client and res.day = p_day and res.mode = 'normal'),
        'hard', (select jsonb_build_object('films', films, 'hints', hints, 'par', par, 'gaveUp', gave_up)
                 from res where res.client = m.client and res.day = p_day and res.mode = 'hard'),
        'week', (select jsonb_build_object(
                   'played', count(*),
                   'points', coalesce(sum(case when gave_up then 0 else greatest(0, 3 - (films - par)) end), 0))
                 from res where res.client = m.client and res.mode = 'normal')
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

-- Only the public functions can be called, by signed-out visitors (anon) and signed-in ones
-- alike; the helpers stay internal.
revoke all on all functions in schema sixdegrees from public;
revoke all on function
  public.sixdegrees_submit(uuid, date, text, int, int, int, boolean, boolean, int, text),
  public.sixdegrees_day(date, text, uuid),
  public.sixdegrees_create_group(uuid, text, text),
  public.sixdegrees_join_group(text, uuid, text),
  public.sixdegrees_leave_group(text, uuid),
  public.sixdegrees_group(text, uuid, date),
  public.sixdegrees_my_groups(uuid)
from public;
grant execute on function
  public.sixdegrees_submit(uuid, date, text, int, int, int, boolean, boolean, int, text),
  public.sixdegrees_day(date, text, uuid),
  public.sixdegrees_create_group(uuid, text, text),
  public.sixdegrees_join_group(text, uuid, text),
  public.sixdegrees_leave_group(text, uuid),
  public.sixdegrees_group(text, uuid, date),
  public.sixdegrees_my_groups(uuid)
to anon, authenticated;
