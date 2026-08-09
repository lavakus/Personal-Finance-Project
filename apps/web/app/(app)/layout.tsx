import { Sidebar } from "@/components/sidebar";
import { Badge } from "@/components/ui";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";
import { demoProfile } from "@/lib/demo-data";

async function getProfileName(): Promise<string> {
  if (isDemoMode) return demoProfile.displayName;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "—";
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  return data?.display_name ?? user.email ?? "Trader";
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const name = await getProfileName();
  return (
    <div className="flex">
      <Sidebar demoMode={isDemoMode} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-(--color-border) bg-(--color-surface) px-5">
          <div className="text-xs text-(--color-text-dim)">
            Data → Analysis → Setup → Plan → <span className="font-semibold text-(--color-text)">your decision</span>
          </div>
          <div className="flex items-center gap-3">
            {isDemoMode ? <Badge tone="demo">Demo data</Badge> : <Badge tone="accent">Connected</Badge>}
            <span className="text-xs text-(--color-text-dim)">{name}</span>
          </div>
        </header>
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
