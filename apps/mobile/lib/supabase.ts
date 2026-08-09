import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isDemoMode, supabaseAnonKey, supabaseUrl } from "./env";

let client: SupabaseClient | null = null;

/** Null in demo mode. Session persistence (SecureStore/AsyncStorage) is
 *  wired with the mobile auth screens in a later slice of Phase 1.x —
 *  Phase 1 mobile runs demo-mode UI. */
export function getSupabase(): SupabaseClient | null {
  if (isDemoMode) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
