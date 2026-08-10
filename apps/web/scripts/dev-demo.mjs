/**
 * Run the web app in DEMO MODE on a separate port.
 *
 * `isDemoMode` is derived from the Supabase env being absent, and Next.js
 * loads `.env.local` without overwriting variables already present in
 * process.env — so setting them to empty strings here wins, and the real
 * credentials in `.env.local` are left untouched.
 *
 * Useful for working on the UI: every page renders labelled sample data with
 * no auth wall, so layouts can be reviewed without touching live records.
 *
 *   npm run dev:demo --workspace apps/web        -> http://localhost:3001
 */
import { spawn } from "node:child_process";

const port = process.env.DEMO_PORT ?? "3001";

spawn("npx", ["next", "dev", "--port", port], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  },
});
