-- ============================================================
-- 0001_foundation — Phase 1
-- profiles + roles, reference data (asset classes, exchanges,
-- sectors, industries, assets), RLS everywhere, signup trigger.
-- ============================================================

-- ---------- enums (mirror @tradeos/types 1:1) ----------
create type user_role as enum ('ADMIN', 'USER');
create type currency_code as enum ('INR', 'OMR', 'USD');
create type asset_class_code as enum
  ('EQUITY_IN', 'CRYPTO', 'GOLD', 'CASH', 'GLOBAL_INDEX', 'OTHER');

-- ---------- updated_at trigger helper ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Trader',
  role user_role not null default 'USER',
  base_currency currency_code not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- First user to sign up becomes ADMIN (personal platform); later users USER.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    case when not exists (select 1 from public.profiles) then 'ADMIN'::user_role
         else 'USER'::user_role end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Admin check for policies. SECURITY DEFINER so it can read profiles
-- without recursive RLS evaluation.
create or replace function is_admin()
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'ADMIN'
  );
$$;

alter table profiles enable row level security;

create policy "read own profile" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "update own profile (not role)" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()));
create policy "admin manages profiles" on profiles
  for all using (is_admin()) with check (is_admin());

-- ---------- reference data ----------
create table asset_classes (
  code asset_class_code primary key,
  name text not null
);

create table exchanges (
  id serial primary key,
  code text not null unique,          -- NSE, BSE, CRYPTO, COMEX
  name text not null,
  country text,
  timezone text not null default 'Asia/Kolkata'
);

create table sectors (
  id serial primary key,
  name text not null unique
);

create table industries (
  id serial primary key,
  sector_id int not null references sectors (id),
  name text not null,
  unique (sector_id, name)
);
create index industries_sector_idx on industries (sector_id);

create table assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text not null,
  asset_class asset_class_code not null references asset_classes (code),
  exchange_id int references exchanges (id),
  industry_id int references industries (id),
  currency currency_code not null default 'INR',
  isin text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (symbol, asset_class)
);
create index assets_class_idx on assets (asset_class);
create index assets_industry_idx on assets (industry_id);
create trigger assets_updated before update on assets
  for each row execute function set_updated_at();

-- Reference data is world-readable to signed-in users; only admin writes.
alter table asset_classes enable row level security;
alter table exchanges enable row level security;
alter table sectors enable row level security;
alter table industries enable row level security;
alter table assets enable row level security;

do $$
declare t text;
begin
  foreach t in array array['asset_classes','exchanges','sectors','industries','assets'] loop
    execute format(
      'create policy "authenticated read" on %I for select using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "admin write" on %I for all using (is_admin()) with check (is_admin());', t);
  end loop;
end $$;
