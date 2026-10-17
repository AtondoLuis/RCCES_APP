import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canManageUsers, type AccessProfile } from "@/lib/permissions";
export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requireAdmin() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AccessError(401, "Inicia sesion para continuar.");
  const result = await client.from("profiles").select("id,role,active,parish_id").eq("id", data.user.id).maybeSingle();
  if (result.error) throw new AccessError(503, "No se pudo verificar el perfil. Revisa la migracion de usuarios.");
  const profile = result.data as (AccessProfile & { id: string }) | null;
  if (!canManageUsers(profile)) throw new AccessError(403, profile?.active === false ? "Tu acceso esta desactivado." : "Acceso exclusivo para ADMIN.");
  return { client, profile: profile!, actorId: data.user.id };
}
export function apiError(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("User administration failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "No se pudo completar la operacion de usuarios." }, { status: 500 });
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new AccessError(403, "Origen no permitido.");
}
