import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canUseApp, permissionsFor } from "@/lib/permissions";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  const isCallback = request.nextUrl.pathname === "/auth/callback";
  const isInternal = !isCallback && !isLogin && !request.nextUrl.pathname.startsWith("/_next") && request.nextUrl.pathname !== "/favicon.ico";
  if (isInternal && !data.user) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Inicia sesion para continuar." }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (data.user && !isCallback) {
    const { data: profile, error } = await supabase.from("profiles").select("role,active,parish_id").eq("id", data.user.id).maybeSingle();
    if (error) return new NextResponse("No se pudo verificar el acceso. Revisa la migracion de usuarios.", { status: 503 });
    if (!canUseApp(profile)) {
      if (isLogin) return response;
      if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Tu acceso esta desactivado o no tienes perfil." }, { status: 403 });
      return NextResponse.redirect(new URL("/login?acceso=desactivado", request.url));
    }
    const adminPath = request.nextUrl.pathname.startsWith("/admin/") || request.nextUrl.pathname.startsWith("/api/admin/");
    if (adminPath && !permissionsFor(profile!.role).manageConfiguration) return new NextResponse("Acceso denegado. Solo ADMIN.", { status: 403 });
    if (isLogin) return NextResponse.redirect(new URL("/comisiones", request.url));
  }
  return response;
}

