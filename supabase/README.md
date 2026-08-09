# Supabase setup

1. Create a free project at supabase.com.
2. Apply migrations in order (SQL editor, or `supabase db push` with the CLI):
   - `migrations/0001_foundation.sql`
   - `seed/0001_reference.sql`
3. Copy Project URL + anon key into `.env.local` (web) and `apps/mobile/.env`
   (`EXPO_PUBLIC_*`). The service-role key goes ONLY into Vercel server env /
   GitHub Actions secrets.
4. Sign up in the app — the **first** account automatically becomes ADMIN.

Until env vars are set, both apps run in DEMO MODE with clearly-labeled
sample data. Demo and live data are never mixed.

Migration rules: append-only, never edit an applied migration; every user
table ships with RLS enabled in the same migration that creates it.
