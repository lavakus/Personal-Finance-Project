-- ============================================================
-- 0008_research — Phases 10–11
-- trade_outcomes (historical signal evaluation, brief §58),
-- backtests + backtest_trades (clearly labeled BACKTEST — never
-- presented as live performance), system_logs.
-- ============================================================

-- One evaluation per published trade plan; written by the evaluation job
-- strictly AFTER the fact using only post-signal bars (no lookahead).
create table trade_outcomes (
  id uuid primary key default gen_random_uuid(),
  stock_ranking_id uuid not null unique references stock_rankings (id) on delete cascade,
  evaluated_through date not null,
  entry_triggered boolean not null,
  entry_date date,
  entry_price numeric(20,6),
  t1_hit boolean not null default false,
  t2_hit boolean not null default false,
  stop_hit boolean not null default false,
  timed_out boolean not null default false,
  exit_date date,
  exit_price numeric(20,6),
  r_multiple numeric(8,3),
  mfe_pct numeric(8,3),               -- max favorable excursion from entry
  mae_pct numeric(8,3),               -- max adverse excursion from entry
  holding_days int,
  outcome text not null check (outcome in
    ('NOT_TRIGGERED','OPEN','T1','T2','STOP','TIMEOUT','INVALIDATED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trade_outcomes_updated before update on trade_outcomes
  for each row execute function set_updated_at();

-- ---------- backtests (brief §59–60) ----------
create table backtests (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  engine text not null default 'swingscan',
  engine_version text not null default '1.0',
  start_date date not null,
  end_date date not null,
  universe text not null default 'NIFTY500',
  capital numeric(20,2) not null,
  parameters jsonb not null default '{}',
  metrics jsonb not null default '{}',     -- win rate, PF, expectancy, dd, sharpe…
  kind text not null default 'BACKTEST' check (kind in
    ('BACKTEST','OUT_OF_SAMPLE','PAPER')),
  created_at timestamptz not null default now()
);

create table backtest_trades (
  id bigserial primary key,
  backtest_id uuid not null references backtests (id) on delete cascade,
  symbol text not null,
  setup_type text,
  entry_date date not null,
  exit_date date not null,
  entry_price numeric(20,6) not null,
  shares int not null,
  net_pnl numeric(20,6) not null,
  r_multiple numeric(8,3),
  holding_days int,
  exit_reason text,
  created_at timestamptz not null default now()
);
create index backtest_trades_bt_idx on backtest_trades (backtest_id);

-- ---------- system logs (brief §84) ----------
create table system_logs (
  id bigserial primary key,
  source text not null,                 -- job/page/api name
  level text not null default 'INFO' check (level in ('INFO','WARN','ERROR')),
  message text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index system_logs_time_idx on system_logs (created_at desc);

-- ---------- RLS: shared reads, admin/service writes ----------
alter table trade_outcomes enable row level security;
alter table backtests enable row level security;
alter table backtest_trades enable row level security;
alter table system_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array
    ['trade_outcomes','backtests','backtest_trades','system_logs']
  loop
    execute format(
      'create policy "authenticated read" on %I for select using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "admin write" on %I for all using (is_admin()) with check (is_admin());', t);
  end loop;
end $$;
