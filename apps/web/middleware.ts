import { NextResponse, type NextRequest } from "next/server";

import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { isDemoMode, supabaseAnonKey, supabaseUrl } from "./lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC_PATHS = ["/login", "/auth"];

// API routes enforce their own auth (session, CRON_SECRET bearer, or bot
// HMAC) — a login REDIRECT is the wrong response for a machine caller.
const SELF_AUTHENTICATED_API = ["/api/jobs/", "/api/bots/", "/api/health"];

export async function middleware(request: NextRequest) {
  // DEMO MODE: no Supabase configured -> no auth wall, demo data only.
  if (isDemoMode) return NextResponse.next();

  if (SELF_AUTHENTICATED_API.some((p) => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all: CookieToSet[]) => {
        all.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        all.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
