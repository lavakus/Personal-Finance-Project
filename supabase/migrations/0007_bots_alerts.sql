-- ============================================================
-- 0007_bots_alerts — Phases 8–9
-- Bot registry + HMAC-keyed ingestion tables, alert rules and
-- notifications. Bot keys are stored HASHED (sha256) — the plaintext
-- key is shown exactly once at creation (brief §64, §79).
-- ============================================================

create type alert_type as enum
  ('PRICE', 'SETUP', 'BREAKOUT', 'PULLBACK', 'TARGET', 'STOP',
   'NEWS', 'EVENT', 'EARNINGS', 'PORTFOLIO', 'BOT', 'DATA');

-- ---------- bots (brief §63) ----------
create table bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  strategy text,
  description text,
  is_active boolean not null default true,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index bots_user_idx on bots (user_id);
create trigger bots_updated before update on bots
  for each row execute function set_updated_at();

create table bot_api_keys (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references bots (id) on delete cascade,
  key_hash text not null unique,            -- sha256 hex of the api key
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index bot_api_keys_bot_idx on bot_api_keys (bot_id);

create table bot_trades (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references bots (id) on delete cascade,
  external_id text not null,                -- bot's own trade id (dedupe)
  symbol text not null,
  direction trade_direction not null default 'LONG',
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  entry_price numeric(20,6) not null,
  exit_price numeric(20,6),
  quantity numeric(20,6) not null,
  pnl numeric(20,6),
  fees numeric(20,6) not null default 0,
  opened_at timestamptz not null,
  closed_at timestamptz,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (bot_id, external_id)
);
create index bot_trades_bot_idx on bot_trades (bot_id, opened_at desc);

create table bot_equity_snapshots (
  id bigserial primary key,
  bot_id uuid not null references bots (id) on delete cascade,
  equity numeric(20,6) not null,
  as_of timestamptz not null,
  created_at timestamptz not null default now(),
  unique (bot_id, as_of)
);
create index bot_equity_bot_idx on bot_equity_snapshots (bot_id, as_of desc);

create table bot_events (
  id bigserial primary key,
  bot_id uuid not null references bots (id) on delete cascade,
  event_type text not null check (event_type in ('HEARTBEAT','ERROR','INFO')),
  message text,
  created_at timestamptz not null default now()
);
create index bot_events_bot_idx on bot_events (bot_id, created_at desc);

-- ---------- alert rules + notifications (brief §66–67) ----------
create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type alert_type not null,
  symbol text,
  condition jsonb not null default '{}',    -- e.g. {"above": 1500} / {"below": 1350}
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index alerts_user_idx on alerts (user_id, is_active);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  alert_id uuid references alerts (id) on delete set null,
  type alert_type not null,
  title text not null,
  body text,
  symbol text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, is_read, created_at desc);

-- ---------- RLS ----------
alter table bots enable row level security;
alter table bot_api_keys enable row level security;
alter table bot_trades enable row level security;
alter table bot_equity_snapshots enable row level security;
alter table bot_events enable row level security;
alter table alerts enable row level security;
alter table notifications enable row level security;

create policy "own bots" on bots
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- key hashes / ingestion tables: owner reads; writes happen via service
-- role (HMAC-validated API) or the owner themselves
create policy "own bot keys" on bot_api_keys
  for all using (
    exists (select 1 from bots b where b.id = bot_id
            and (b.user_id = auth.uid() or is_admin()))
  ) with check (
    exists (select 1 from bots b where b.id = bot_id
            and (b.user_id = auth.uid() or is_admin()))
  );

do $$
declare t text;
begin
  foreach t in array array['bot_trades','bot_equity_snapshots','bot_events'] loop
    execute format(
      'create policy "read own bot data" on %I for select using (
         exists (select 1 from bots b where b.id = bot_id
                 and (b.user_id = auth.uid() or is_admin())));', t);
  end loop;
end $$;

create policy "own alerts" on alerts
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());
create policy "own notifications" on notifications
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());
