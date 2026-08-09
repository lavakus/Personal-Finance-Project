-- ============================================================
-- 0006_news_events — Phase 6
-- news_articles (+asset mapping), corporate_events, earnings_events.
-- Sentiment/impact are stored as HEURISTIC labels (brief §35); events
-- are manually curated or provider-fed later — never fabricated.
-- ============================================================

create type sentiment_label as enum ('POSITIVE', 'NEUTRAL', 'NEGATIVE');
create type impact_label as enum ('HIGH', 'MEDIUM', 'LOW');

create table news_articles (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  url text not null unique,
  source text not null,
  category text not null default 'INDIAN_MARKET',
  published_at timestamptz not null,
  sentiment sentiment_label not null default 'NEUTRAL',
  impact impact_label not null default 'LOW',
  summary text,
  created_at timestamptz not null default now()
);
create index news_articles_published_idx on news_articles (published_at desc);
create index news_articles_category_idx on news_articles (category, published_at desc);

create table news_assets (
  id bigserial primary key,
  article_id uuid not null references news_articles (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete cascade,
  unique (article_id, asset_id)
);
create index news_assets_asset_idx on news_assets (asset_id);

create table corporate_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets (id) on delete cascade,
  symbol text not null,
  event_type text not null,             -- EARNINGS, DIVIDEND, SPLIT, BONUS, AGM, M&A, OTHER
  event_date date not null,
  title text not null,
  details text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (symbol, event_type, event_date)
);
create index corporate_events_date_idx on corporate_events (event_date);

create table earnings_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets (id) on delete cascade,
  symbol text not null,
  earnings_date date not null,
  period text,                          -- Q1FY27 etc
  confirmed boolean not null default false,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (symbol, earnings_date)
);
create index earnings_events_date_idx on earnings_events (earnings_date);

-- ---------- RLS: shared reads, admin writes ----------
alter table news_articles enable row level security;
alter table news_assets enable row level security;
alter table corporate_events enable row level security;
alter table earnings_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array
    ['news_articles','news_assets','corporate_events','earnings_events']
  loop
    execute format(
      'create policy "authenticated read" on %I for select using (auth.role() = ''authenticated'');', t);
    execute format(
      'create policy "admin write" on %I for all using (is_admin()) with check (is_admin());', t);
  end loop;
end $$;
