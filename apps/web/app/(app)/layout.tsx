import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { demoProfile } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

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
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <Topbar name={name} demoMode={isDemoMode} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
