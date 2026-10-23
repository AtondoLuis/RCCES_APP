import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canUseApp, canAccessPath, canViewCommission } from "@/lib/permissions";

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
    if (!canAccessPath(profile!.role, request.nextUrl.pathname)) return new NextResponse("Acceso denegado.", { status: 403 });
    const commissionId = request.nextUrl.pathname.match(/^\/comisiones\/([^/]+)/)?.[1];
    if (commissionId && commissionId !== "nueva") {
      const result = await supabase.from("masses").select("id,status").eq("id", commissionId).eq("parish_id", profile!.parish_id).maybeSingle();
      if (result.error) return new NextResponse("No se pudo verificar la comision.", { status: 503 });
      if (!result.data || !canViewCommission(profile!.role, result.data.status)) return new NextResponse("Acceso denegado.", { status: 403 });
    }
    if (isLogin) return NextResponse.redirect(new URL("/comisiones", request.url));
  }
  return response;
}

