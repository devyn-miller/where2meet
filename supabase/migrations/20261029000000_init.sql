-- where2meet schema.
-- Coordinates are stored only after rounding to the participant's chosen
-- precision. A trigger rounds again and a check constraint rejects anything
-- finer, so the database can never hold an exact point.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- events
create table public.events (
  id          text primary key check (id ~ '^[A-Za-z0-9]{10,32}$'),
  name        text not null check (char_length(name) between 1 and 100),
  meeting_at  timestamptz,
  mode        text not null default 'distance' check (mode in ('distance', 'drive')),
  priority    text not null default 'total' check (priority in ('total', 'even')),
  version     integer not null default 1,
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- drive-time mode unlocks only once a meeting time is set
  check (mode = 'distance' or meeting_at is not null)
);

create table public.event_secrets (
  event_id              text primary key references public.events (id) on delete cascade,
  organizer_token_hash  text not null
);

-- ---------------------------------------------------------- participants
create table public.participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null references public.events (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  lat         numeric(7, 4) check (lat between -90 and 90),
  lng         numeric(8, 4) check (lng between -180 and 180),
  precision   smallint not null default 3 check (precision between 1 and 4),
  weight      numeric(2, 1) not null default 1 check (weight in (0.5, 1, 1.5, 2, 3)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check (lat is null or (lat = round(lat, precision) and lng = round(lng, precision)))
);

create index participants_event_id_idx on public.participants (event_id);

create table public.participant_secrets (
  participant_id   uuid primary key references public.participants (id) on delete cascade,
  edit_token_hash  text not null
);

-- Server-side enforcement of rounding (the API rounds too).
create function public.round_participant_coords() returns trigger
language plpgsql as $$
begin
  if new.lat is not null then
    new.lat := round(new.lat, new.precision);
    new.lng := round(new.lng, new.precision);
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger participants_round
  before insert or update on public.participants
  for each row execute function public.round_participant_coords();

-- Any participant change bumps the event version so stale results are never saved.
create function public.bump_event_version() returns trigger
language plpgsql as $$
begin
  update public.events
     set version = version + 1, updated_at = now()
   where id = coalesce(new.event_id, old.event_id);
  return null;
end $$;

create trigger participants_bump_version
  after insert or update or delete on public.participants
  for each row execute function public.bump_event_version();

-- Settings changes bump the version; saving a result does not.
create function public.events_settings_version() returns trigger
language plpgsql as $$
begin
  if (new.name, new.meeting_at, new.mode, new.priority)
     is distinct from (old.name, old.meeting_at, old.mode, old.priority) then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger events_version
  before update on public.events
  for each row execute function public.events_settings_version();

-- ------------------------------------------------------------ ORS cache
-- key = rounded origin | rounded candidate | hour-of-week
create table public.ors_matrix_cache (
  key          text primary key,
  duration_s   real,
  distance_m   real,
  created_at   timestamptz not null default now()
);

create table public.ors_usage (
  day    date not null,
  kind   text not null,
  count  integer not null default 0,
  primary key (day, kind)
);

create function public.increment_ors_usage(p_day date, p_kind text, p_by integer)
returns integer language sql as $$
  insert into public.ors_usage (day, kind, count) values (p_day, p_kind, p_by)
  on conflict (day, kind) do update set count = public.ors_usage.count + excluded.count
  returning count;
$$;

-- ------------------------------------------------------- row-level security
-- The app's API routes use the service role and check the organizer token or
-- the participant's edit token themselves. For direct (anon) access, RLS
-- allows reading an event and its participants only when the request names
-- that event id in the x-event-id header. Anon can write nothing: adding a
-- row goes through the API so it gets an edit token and rate limiting.
alter table public.events              enable row level security;
alter table public.event_secrets       enable row level security;
alter table public.participants        enable row level security;
alter table public.participant_secrets enable row level security;
alter table public.ors_matrix_cache    enable row level security;
alter table public.ors_usage           enable row level security;

create function public.requested_event_id() returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true)::json ->> 'x-event-id', '')
$$;

create policy events_read_by_id on public.events
  for select to anon, authenticated
  using (id = public.requested_event_id());

create policy participants_read_by_event on public.participants
  for select to anon, authenticated
  using (event_id = public.requested_event_id());

-- No policies on secrets, cache or usage: only the service role can touch them.
revoke all on public.event_secrets, public.participant_secrets,
              public.ors_matrix_cache, public.ors_usage from anon, authenticated;
revoke insert, update, delete on public.events, public.participants from anon, authenticated;
revoke execute on function public.increment_ors_usage(date, text, integer) from public, anon, authenticated;
