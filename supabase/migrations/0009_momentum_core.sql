-- ============================================================
-- 0009_momentum_core
-- Lets a second selection engine publish alongside swingscan.
--
-- The momentum core is a cross-sectional factor: rank the universe on 12-1
-- momentum, hold the top N for months, no entry timing. It shares the scan
-- tables so the app's read paths, history and evaluation all work unchanged.
-- ============================================================

-- 1. A factor pick is neither a pullback nor a breakout.
--    (Must be committed before any row uses it — Postgres disallows using a
--     new enum value in the same transaction that added it.)
alter type setup_type add value if not exists 'MOMENTUM';

-- 2. scan_runs was unique on run_date alone, so two engines could not both
--    publish for the same trading day. Key it by engine as well.
alter table scan_runs drop constraint if exists scan_runs_run_date_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scan_runs_run_date_engine_key'
  ) then
    alter table scan_runs
      add constraint scan_runs_run_date_engine_key unique (run_date, engine);
  end if;
end $$;

create index if not exists scan_runs_engine_date_idx
  on scan_runs (engine, run_date desc);

-- 3. Regime is swingscan's concept. A factor rebalance records it as context
--    but must not be forced to invent one.
alter table scan_runs alter column regime_label drop not null;
alter table scan_runs alter column regime_score drop not null;

-- 4. Factor-specific fields on a ranking. Nullable so swingscan rows are
--    unaffected.
alter table stock_rankings
  add column if not exists weight_pct numeric(8,4),
  add column if not exists momentum_pct numeric(10,4),
  add column if not exists vol_annual_pct numeric(10,4),
  add column if not exists hold_until date;

comment on column stock_rankings.weight_pct is
  'Equal-weight target for factor engines; null for timing engines.';
comment on column stock_rankings.hold_until is
  'Next scheduled rebalance. Factor picks are held to this date, not to a stop.';
