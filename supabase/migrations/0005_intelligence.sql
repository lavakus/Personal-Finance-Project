-- ============================================================
-- 0005_intelligence — Phase 5
-- Scanner outputs (swingscan → Supabase): market regime history,
-- breadth, sector rankings, scan runs + stock rankings + trade plans.
-- Scans are append-only history (brief §57); a same-day re-publish
-- replaces only that day's run. Plus watchlists (brief §49).
-- ============================================================

-- ---------- market regime history (brief §19) ----------
create table market_regime_history (
  date date primary key,
  label text not null,                 -- STRONG_BULLISH … STRONG_BEARISH
  score numeric(6,2) not null,         -- composite [-100, 100]
  breadth_pct numeric(6,2),            -- % of universe above EMA50
  vix numeric(10,4),
  nifty_close numeric(20,6),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- market breadth history (brief §41) ----------
create table market_breadth (
  date date primary key,
  pct_above_ema50 numeric(6,2),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- sector rankings (brief §20) ----------
create table sector_rankings (
  id bigserial primary key,
  date date not null,
  sector text not null,
  rank int not null,
  rs5 numeric(8,3),
  rs10 numeric(8,3),
  rs20 numeric(8,3),
  rs60 numeric(8,3),
  rs_blend numeric(8,3),
  score numeric(6,2),
  created_at timestamptz not null default now(),
  unique (date, sector)
);
create index sector_rankings_date_idx on sector_rankings (date desc, rank);

-- ---------- scan runs (brief §57 — keep every scan) ----------
create table scan_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null unique,       -- one published run per trading day
  engine text not null default 'swingscan',
  engine_version text not null default '1.0',
  universe text not null default 'NIFTY500',
  regime_label text not null,
  regime_score numeric(6,2) not null,
  funnel jsonb not null default '{}',
  no_trade boolean not null default false,
  no_trade_reason text,
  near_misses jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table stock_rankings (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references scan_runs (id) on delete cascade,
  rank int not null,
  symbol text not null,
  name text not null,
  sector text,
  sector_rank int,
  price numeric(20,6) not null,
  atr numeric(20,6),
  setup_type setup_type not null,
  score_total numeric(6,2) not null,
  score_tier text not null,
  score_components jsonb not null default '{}',   -- explainability (brief §3)
  score_weights jsonb not null default '{}',
  why jsonb not null default '[]',
  warnings jsonb not null default '[]',
  rs_excess_nifty_20d numeric(8,3),
  created_at timestamptz not null default now(),
  unique (scan_run_id, symbol)
);
create index stock_rankings_run_idx on stock_rankings (scan_run_id, rank);
create index stock_rankings_symbol_idx on stock_rankings (symbol, created_at desc);

create table trade_plans (
  id uuid primary key default gen_random_uuid(),
  stock_ranking_id uuid not null unique references stock_rankings (id) on delete cascade,
  entry_low numeric(20,6) not null,
  entry_high numeric(20,6) not null,
  entry_mid numeric(20,6) not null,
  stop numeric(20,6) not null,
  t1 numeric(20,6) not null,
  t2 numeric(20,6) not null,
  rr1 numeric(8,3) not null,
  rr2 numeric(8,3) not null,
  risk_per_share numeric(20,6),
  do_not_chase_above numeric(20,6),
  structure_low numeric(20,6),
  key_level numeric(20,6),
  max_holding_days int not null default 15,
  entry_conditions jsonb not null default '[]',
  exit_conditions jsonb not null default '[]',
  invalidation jsonb not null default '[]',
  sizing jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- watchlists (brief §49) ----------
create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);
create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlists (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  symbol text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);
create index watchlist_items_list_idx on watchlist_items (watchlist_id);

-- ---------- RLS ----------
alter table market_regime_history enable row level security;
alter table market_breadth enable row level security;
alter table sector_rankings enable row level security;
alter table scan_runs enable row level security;
alter table stock_rankings enable row level security;
alter table trade_plans enable row level security;
alter table watchlists enable row level security;
alter table watchlist_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array
    ['market_regime_history','market_breadth','sector_rankings',
     'scan_runs','stock_rankings','trade_plans']
  loop
    execute format(
      'create policy "authenticated read" on %I for select using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "admin write" on %I for all using (is_admin()) with check (is_admin());', t);
  end loop;
  foreach t in array array['watchlists','watchlist_items'] loop
    execute format(
      'create policy "own rows" on %I for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());', t);
  end loop;
end $$;
