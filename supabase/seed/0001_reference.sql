-- Reference seed (idempotent). Assets themselves are synced by jobs
-- (NIFTY 500 universe -> assets) in Phase 4; this seeds the frame.

insert into asset_classes (code, name) values
  ('EQUITY_IN', 'Indian Equity'),
  ('CRYPTO', 'Cryptocurrency'),
  ('GOLD', 'Gold'),
  ('CASH', 'Cash'),
  ('GLOBAL_INDEX', 'Global Index'),
  ('OTHER', 'Other')
on conflict (code) do nothing;

insert into exchanges (code, name, country, timezone) values
  ('NSE', 'National Stock Exchange of India', 'IN', 'Asia/Kolkata'),
  ('BSE', 'BSE Ltd', 'IN', 'Asia/Kolkata'),
  ('CRYPTO', 'Crypto (aggregate)', null, 'UTC'),
  ('GLOBAL', 'Global markets', null, 'UTC')
on conflict (code) do nothing;

-- NSE macro sectors (industries sync from the NIFTY 500 file in Phase 4)
insert into sectors (name) values
  ('Information Technology'), ('Financial Services'),
  ('Automobile and Auto Components'), ('Healthcare'),
  ('Fast Moving Consumer Goods'), ('Metals & Mining'), ('Realty'),
  ('Oil Gas & Consumable Fuels'), ('Power'), ('Capital Goods'),
  ('Construction'), ('Construction Materials'), ('Consumer Durables'),
  ('Consumer Services'), ('Chemicals'), ('Services'),
  ('Telecommunication'), ('Media Entertainment & Publication'),
  ('Textiles'), ('Diversified'), ('Forest Materials')
on conflict (name) do nothing;
