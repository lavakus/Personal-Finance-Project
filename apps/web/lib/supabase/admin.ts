import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseUrl } from "../env";

/**
 * Service-role client — bypasses RLS. Server-side ONLY (enforced by the
 * `server-only` import). Used exclusively for shared reference data that
 * regular users may not write directly (e.g. asset upserts) and cron jobs.
 * Every call site must have already authenticated the session itself.
 */
export function createAdminSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("service-role client unavailable (env not configured)");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
