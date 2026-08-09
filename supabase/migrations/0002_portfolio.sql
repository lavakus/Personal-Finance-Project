-- ============================================================
-- 0002_portfolio — Phase 2
-- portfolio_accounts, transactions (source of truth for holdings),
-- fx_rates. Holdings are DERIVED from the transaction ledger at read
-- time (walkLedger in @tradeos/calculations) — never hand-edited.
-- ============================================================

create type transaction_type as enum
  ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'FEE', 'TRANSFER');

-- ---------- portfolio accounts ----------
create table portfolio_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  currency currency_code not null default 'INR',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);
create index portfolio_accounts_user_idx on portfolio_accounts (user_id);
create trigger portfolio_accounts_updated before update on portfolio_accounts
  for each row execute function set_updated_at();

-- Every profile gets a default account; backfill existing profiles.
create or replace function handle_new_profile_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.portfolio_accounts (user_id, name, currency, is_default)
  values (new.id, 'Main', new.base_currency, true);
  return new;
end $$;

create trigger on_profile_created_account
  after insert on profiles
  for each row execute function handle_new_profile_account();

insert into portfolio_accounts (user_id, name, currency, is_default)
select p.id, 'Main', p.base_currency, true
from profiles p
where not exists (
  select 1 from portfolio_accounts a where a.user_id = p.id
);

-- ---------- transactions (the ledger; brief §11) ----------
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  account_id uuid not null references portfolio_accounts (id),
  asset_id uuid references assets (id),
  type transaction_type not null,
  quantity numeric(20,6),
  price numeric(20,6),
  amount numeric(20,6) not null,          -- gross cash value, always >= 0; sign implied by type
  currency currency_code not null,
  fees numeric(20,6) not null default 0,
  executed_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint positive_amount check (amount >= 0),
  constraint positive_fees check (fees >= 0),
  constraint positive_quantity check (quantity is null or quantity > 0),
  constraint positive_price check (price is null or price >= 0),
  -- BUY/SELL/DIVIDEND must reference an asset; BUY/SELL need qty + price
  constraint asset_required check (
    type not in ('BUY','SELL','DIVIDEND') or asset_id is not null
  ),
  constraint qty_price_required check (
    type not in ('BUY','SELL') or (quantity is not null and price is not null)
  )
);
create index transactions_user_time_idx on transactions (user_id, executed_at);
create index transactions_account_idx on transactions (account_id);
create index transactions_asset_idx on transactions (asset_id);
create trigger transactions_updated before update on transactions
  for each row execute function set_updated_at();

-- ---------- fx rates (multi-currency, brief §12) ----------
create table fx_rates (
  id serial primary key,
  rate_date date not null,
  base currency_code not null,
  quote currency_code not null,
  rate numeric(20,8) not null check (rate > 0),
  provider text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (rate_date, base, quote)
);

-- ---------- RLS ----------
alter table portfolio_accounts enable row level security;
alter table transactions enable row level security;
alter table fx_rates enable row level security;

create policy "own accounts" on portfolio_accounts
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy "own transactions" on transactions
  for all using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy "authenticated read fx" on fx_rates
  for select using (auth.role() = 'authenticated');
create policy "admin write fx" on fx_rates
  for all using (is_admin()) with check (is_admin());
