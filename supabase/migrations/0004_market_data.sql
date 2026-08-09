-- ============================================================
-- 0004_market_data — Phase 4
-- market_indices reference, market_quotes (latest-quote cache),
-- daily_prices (EOD history), technical_indicators (filled by the
-- Phase 5 scanner), data_provider_status. Every row carries provider
-- + freshness; the UI must show freshness badges (brief §76).
-- ============================================================

create type data_freshness as enum
  ('LIVE', 'RECENT', 'STALE', 'DEMO', 'UNAVAILABLE');

-- ---------- indices reference ----------
create table market_indices (
  code text primary key,              -- NIFTY50, BANKNIFTY, INDIAVIX, SP500…
  name text not null,
  provider_symbol text not null,      -- ^NSEI, ^GSPC, GC=F…
  currency currency_code not null default 'USD',
  sort_order int not null default 100
);

insert into market_indices (code, name, provider_symbol, currency, sort_order) values
  ('NIFTY50',   'NIFTY 50',     '^NSEI',     'INR', 10),
  ('BANKNIFTY', 'BANK NIFTY',   '^NSEBANK',  'INR', 20),
  ('INDIAVIX',  'INDIA VIX',    '^INDIAVIX', 'INR', 30),
  ('SP500',     'S&P 500',      '^GSPC',     'USD', 40),
  ('NASDAQ',    'NASDAQ',       '^IXIC',     'USD', 50),
  ('DOWJONES',  'Dow Jones',    '^DJI',      'USD', 60),
  ('GOLD',      'Gold (COMEX)', 'GC=F',      'USD', 70),
  ('USDINR',    'USD/INR',      'USDINR=X',  'INR', 80);

-- ---------- latest-quote cache ----------
-- Exactly one of asset_id / index_code per row.
create table market_quotes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid unique references assets (id) on delete cascade,
  index_code text unique references market_indices (code) on delete cascade,
  price numeric(20,6) not null,
  change_pct numeric(10,4) not null default 0,
  as_of timestamptz not null,
  provider text not null,
  freshness data_freshness not null default 'STALE',
  updated_at timestamptz not null default now(),
  constraint one_target check (
    (asset_id is not null)::int + (index_code is not null)::int = 1
  )
);

-- ---------- EOD price history ----------
create table daily_prices (
  id bigserial primary key,
  asset_id uuid not null references assets (id) on delete cascade,
  date date not null,
  open numeric(20,6) not null,
  high numeric(20,6) not null,
  low numeric(20,6) not null,
  close numeric(20,6) not null,
  volume bigint not null default 0,
  provider text not null,
  created_at timestamptz not null default now(),
  unique (asset_id, date)
);
create index daily_prices_asset_date_idx on daily_prices (asset_id, date desc);

-- ---------- indicators (written by the Phase 5 scanner) ----------
create table technical_indicators (
  id bigserial primary key,
  asset_id uuid not null references assets (id) on delete cascade,
  date date not null,
  ema20 numeric(20,6),
  ema50 numeric(20,6),
  ema200 numeric(20,6),
  rsi14 numeric(10,4),
  macd numeric(20,6),
  macd_signal numeric(20,6),
  macd_hist numeric(20,6),
  adx14 numeric(10,4),
  atr14 numeric(20,6),
  roc5 numeric(10,4),
  roc10 numeric(10,4),
  roc20 numeric(10,4),
  volume_sma20 numeric(20,2),
  relative_volume numeric(10,4),
  created_at timestamptz not null default now(),
  unique (asset_id, date)
);
create index technical_indicators_asset_date_idx
  on technical_indicators (asset_id, date desc);

-- ---------- provider health (brief §76, §84) ----------
create table data_provider_status (
  provider text primary key,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------
-- Market data is shared reference data: authenticated read, service-role
-- (cron jobs) writes bypass RLS; no user writes.
alter table market_indices enable row level security;
alter table market_quotes enable row level security;
alter table daily_prices enable row level security;
alter table technical_indicators enable row level security;
alter table data_provider_status enable row level security;

do $$
declare t text;
begin
  foreach t in array array
    ['market_indices','market_quotes','daily_prices','technical_indicators','data_provider_status']
  loop
    execute format(
      'create policy "authenticated read" on %I for select using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "admin write" on %I for all using (is_admin()) with check (is_admin());', t);
  end loop;
end $$;
