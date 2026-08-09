/**
 * Environment access + DEMO MODE detection.
 *
 * DEMO MODE is on whenever Supabase env vars are absent. In demo mode the
 * app renders clearly-labeled sample data, auth is bypassed with a demo
 * profile, and nothing is ever written anywhere. Demo and live data are
 * never mixed (brief §83): the switch is global, not per-widget.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isDemoMode = !supabaseUrl || !supabaseAnonKey;
