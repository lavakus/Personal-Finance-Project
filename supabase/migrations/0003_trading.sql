-- ============================================================
-- 0003_trading — Phase 3
-- strategies (+ immutable versions), trades journal, partial exits,
-- behavioral reviews, notes. Trades store the strategy VERSION used
-- (brief §17); realized P&L and R are derived, never hand-entered.
-- ============================================================

create type trade_status as enum
  ('PLANNED', 'ACTIVE', 'PARTIALLY_CLOSED', 'CLOSED', 'CANCELLED', 'INVALIDATED');
create type trade_direction as enum ('LONG', 'SHORT');
create type setup_type as enum ('PULLBACK', 'BREAKOUT');

-- ---------- strategies ----------
-- user_id NULL = system strategy (admin-managed, e.g. the swingscan
-- strategies); otherwise personal.
create table strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);
create index strategies_user_idx on strategies (user_id);
create trigger strategies_updated before update on strategies
  for each row execute function set_updated_at();

-- Versions are append-only: rows are never updated once referenced.
create table strategy_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies (id) on delete cascade,
  version text not null,                    -- '1.0', '1.1', '2.0'
  parameters jsonb not null default '{}',   -- configurable knobs snapshot
  notes text,
  created_at timestamptz not null default now(),
  unique (strategy_id, version)
);
create index strategy_versions_strategy_idx on strategy_versions (strategy_id);

-- ---------- trades (journal, brief §14–15) ----------
create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  asset_id uuid not null references assets (id),
  direction trade_direction not null,
  status trade_status not null default 'PLANNED',
  entry_price numeric(20,6) not null check (entry_price > 0),
  quantity numeric(20,6) not null check (quantity > 0),
  stop_loss numeric(20,6) not null check (stop_loss > 0),
  target1 numeric(20,6),
  target2 numeric(20,6),
  strategy_version_id uuid references strategy_versions (id),
  setup setup_type,
  entry_date date not null,
  reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trades_user_status_idx on trades (user_id, status);
create index trades_asset_idx on trades (asset_id);
create trigger trades_updated before update on trades
  for each row execute function set_updated_at();

-- Partial closes supported: one row per exit (brief §15 PARTIALLY_CLOSED).
create table trade_exits (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  exit_price numeric(20,6) not null check (exit_price > 0),
  quantity numeric(20,6) not null check (quantity > 0),
  fees numeric(20,6) not null default 0 check (fees >= 0),
  exit_date date not null,
  exit_reason text,
  created_at timestamptz not null default now()
);
create index trade_exits_trade_idx on trade_exits (trade_id);
create index trade_exits_user_idx on trade_exits (user_id);

-- Behavioral review (brief §16) — one per trade, written after close.
create table trade_reviews (
  trade_id uuid primary key references trades (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  followed_strategy boolean,
  followed_entry boolean,
  respected_stop boolean,
  followed_target boolean,
  exited_early boolean,
  chased_entry boolean,
  moved_stop boolean,
  emotion text,
  lessons text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trade_reviews_user_idx on trade_reviews (user_id);
create trigger trade_reviews_updated before update on trade_reviews
  for each row execute function set_updated_at();

create table trade_notes (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index trade_notes_trade_idx on trade_notes (trade_id);

-- ---------- RLS ----------
alter table strategies enable row level security;
alter table strategy_versions enable row level security;
alter table trades enable row level security;
alter table trade_exits enable row level security;
alter table trade_reviews enable row level security;
alter table trade_notes enable row level security;

-- strategies: read own + system (user_id is null); write own; admin all
create policy "read own or system strategies" on strategies
  for select using (user_id = auth.uid() or user_id is null or is_admin());
create policy "write own strategies" on strategies
  for insert with check (user_id = auth.uid() or is_admin());
create policy "update own strategies" on strategies
  for update using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());
create policy "admin deletes strategies" on strategies
  for delete using (is_admin());

create policy "read versions of visible strategies" on strategy_versions
  for select using (
    exists (
      select 1 from strategies s
      where s.id = strategy_id
        and (s.user_id = auth.uid() or s.user_id is null or is_admin())
    )
  );
create policy "write versions of own strategies" on strategy_versions
  for insert with check (
    exists (
      select 1 from strategies s
      where s.id = strategy_id and (s.user_id = auth.uid() or is_admin())
    )
  );

do $$
declare t text;
begin
  foreach t in array array['trades','trade_exits','trade_reviews','trade_notes'] loop
    execute format(
      'create policy "own rows" on %I for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());', t);
  end loop;
end $$;

-- ---------- seed system strategies (admin-visible to all) ----------
with s as (
  insert into strategies (user_id, name, description) values
    (null, 'Indian Swing Pullback', 'Trend pullback to EMA/support with reversal confirmation (swingscan)'),
    (null, 'Indian Breakout', 'Consolidation breakout with volume expansion (swingscan)'),
    (null, 'BTC Trend', 'Bitcoin trend following'),
    (null, 'Gold Trend', 'Gold trend following'),
    (null, 'Manual', 'Discretionary trades outside any system')
  returning id, name
)
insert into strategy_versions (strategy_id, version, notes)
select id, '1.0', 'initial version' from s;
