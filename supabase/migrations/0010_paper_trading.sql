-- Paper trading: the swing scanner run as a funded book (brief §12 "separate
-- live / paper / backtest / demo data").
--
-- Deliberately its own tables rather than reusing `trades`: that table is for
-- positions the USER entered by hand and requires an asset_id + a decision.
-- These rows are produced by a deterministic replay of the engine, carry no
-- human intent, and must never be mistaken for real fills. Keeping them apart
-- means a paper P&L can never leak into portfolio totals.
--
-- Shaped to mirror bots / bot_trades / bot_equity_snapshots so the dashboard
-- and page can present a paper book exactly like a live bot.

create table paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  engine text not null default 'swingscan',
  -- The policy this book trades under. Stored, not hardcoded in the runner, so
  -- a result can always be traced to the rules that produced it.
  starting_capital numeric(20,2) not null check (starting_capital > 0),
  per_position numeric(20,2) not null check (per_position > 0),
  min_score numeric(6,2) not null default 80,
  max_open int not null default 10 check (max_open > 0),
  start_date date not null,
  cash numeric(20,2),
  equity numeric(20,2),
  last_run_at timestamptz,
  data_through date,          -- last market bar the book is marked to
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create trigger paper_accounts_updated before update on paper_accounts
  for each row execute function set_updated_at();

create table paper_positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references paper_accounts (id) on delete cascade,
  symbol text not null,
  setup_type setup_type not null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  entry_date date not null,
  entry_price numeric(20,6) not null check (entry_price > 0),
  shares int not null check (shares > 0),
  remaining int not null default 0,
  stop numeric(20,6) not null,
  t1 numeric(20,6),
  t2 numeric(20,6),
  score numeric(6,2),
  sector text,
  regime text,
  -- Closed-only fields.
  exit_date date,
  exit_reason text,
  gross_pnl numeric(20,2),
  charges numeric(20,2),
  net_pnl numeric(20,2),
  r_multiple numeric(10,4),
  holding_days int,
  t1_hit boolean not null default false,
  -- Open-only marks.
  last_close numeric(20,6),
  unrealized numeric(20,2),
  created_at timestamptz not null default now(),
  -- The replay is deterministic, so one name entered on one date is one
  -- position. This is what makes the daily job idempotent: it re-runs the
  -- whole history and upserts instead of appending duplicates.
  unique (account_id, symbol, entry_date)
);
create index paper_positions_account_idx on paper_positions (account_id, status);
create index paper_positions_entry_idx on paper_positions (account_id, entry_date desc);

create table paper_equity_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references paper_accounts (id) on delete cascade,
  as_of date not null,
  equity numeric(20,2) not null,
  cash numeric(20,2) not null,
  open_positions int not null default 0,
  unique (account_id, as_of)
);
create index paper_equity_account_idx on paper_equity_snapshots (account_id, as_of desc);

-- RLS: same model as the rest of the app -- a user sees only their own rows.
alter table paper_accounts enable row level security;
alter table paper_positions enable row level security;
alter table paper_equity_snapshots enable row level security;

create policy paper_accounts_own on paper_accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy paper_positions_own on paper_positions
  for all using (
    exists (select 1 from paper_accounts a
            where a.id = account_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from paper_accounts a
            where a.id = account_id and a.user_id = auth.uid())
  );

create policy paper_equity_own on paper_equity_snapshots
  for all using (
    exists (select 1 from paper_accounts a
            where a.id = account_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from paper_accounts a
            where a.id = account_id and a.user_id = auth.uid())
  );
