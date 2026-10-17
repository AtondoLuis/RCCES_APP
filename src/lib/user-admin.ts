import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { AccessError, type requireAdmin } from "@/lib/admin-access";
const fields = { full_name: z.string().trim().min(1).max(150), role: z.enum(["ADMIN", "COORDINADOR", "LECTOR"]),
  active: z.boolean(), person_id: z.string().uuid().nullable() };
const inviteSchema = z.object({ ...fields, email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()) }).strict();
const updateSchema = z.object({ ...fields, id: z.string().uuid() }).strict();
type Context = Awaited<ReturnType<typeof requireAdmin>>;
function dbError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw new AccessError(409, "El servidor ya esta vinculado a otro usuario o el usuario ya existe.");
  if (error.code === "23514") throw new AccessError(409, "Debe quedar al menos un ADMIN activo y el servidor debe pertenecer a la misma parroquia.");
  throw new AccessError(503, "No se pudo guardar el perfil. Revisa la migracion y los permisos.");
}
async function validatePerson(context: Context, personId: string | null, targetId?: string) {
  if (!personId) return;
  const person = await context.client.from("people").select("id").eq("id", personId).eq("parish_id", context.profile.parish_id).maybeSingle();
  if (person.error || !person.data) throw new AccessError(400, "Servidor no disponible en tu parroquia.");
  const existing = await context.client.from("profiles").select("id").eq("person_id", personId).eq("parish_id", context.profile.parish_id).maybeSingle();
  dbError(existing.error);
  if (existing.data && existing.data.id !== targetId) throw new AccessError(409, "El servidor ya esta vinculado a otro usuario.");
}
function authAdmin() {
  try { return createAdminClient(); } catch { throw new AccessError(503, "Falta configurar la clave de administracion en el servidor."); }
}
async function listParishPeople(context: Context) {
  const people: { id: string; first_name: string; last_name: string; display_name: string | null }[] = [];
  for (let from = 0; ; from += 500) {
    const result = await context.client.from("people").select("id,first_name,last_name,display_name")
      .eq("parish_id", context.profile.parish_id).order("first_name").order("id").range(from, from + 499);
    if (result.error) throw new AccessError(503, "No se pudieron cargar los servidores de tu parroquia.");
    people.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) return people;
  }
}
export async function listAppUsers(context: Context, page = 0) {
  const start = Math.max(0, Math.min(page, 10000)) * 50;
  const [profiles, people] = await Promise.all([
    context.client.from("profiles").select("id,full_name,email,role,active,person_id", { count: "exact" }).eq("parish_id", context.profile.parish_id).order("created_at").order("id").range(start, start + 49),
    listParishPeople(context),
  ]);
  if (profiles.error) throw new AccessError(503, "No se pudo cargar usuarios y servidores.");
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? authAdmin() : null;
  const users = await Promise.all((profiles.data ?? []).map(async (profile) => {
    if (!admin) return { ...profile, last_sign_in_at: null, pending_invitation: null };
    const { data, error } = await admin.auth.admin.getUserById(profile.id);
    if (error) throw new AccessError(503, "No se pudo consultar el estado de acceso de los usuarios.");
    return { ...profile, last_sign_in_at: data.user.last_sign_in_at ?? null,
      pending_invitation: !!data.user.invited_at && !data.user.last_sign_in_at && !data.user.email_confirmed_at };
  }));
  return { users, people, total: profiles.count ?? 0, invitationsConfigured: !!admin };
}
export async function inviteAppUser(context: Context, body: unknown) {
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) throw new AccessError(400, "Datos invalidos. Completa nombre, email, rol y estado; no envies parroquia.");
  const input = parsed.data;
  await validatePerson(context, input.person_id);
  const duplicate = await context.client.from("profiles").select("id").eq("parish_id", context.profile.parish_id).eq("email", input.email).maybeSingle();
  dbError(duplicate.error);
  if (duplicate.data) throw new AccessError(409, "Este usuario ya tiene acceso a la parroquia.");
  const configured = process.env.APP_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3100" : "");
  let site: URL;
  try { site = new URL(configured); } catch { throw new AccessError(503, "Configura APP_URL en el servidor para las invitaciones."); }
  if (site.protocol !== "https:" && !(site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname))) throw new AccessError(503, "APP_URL debe usar HTTPS.");
  const admin = authAdmin();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.full_name }, redirectTo: new URL("/auth/callback", site.origin).href,
  });
  if (error || !data.user) throw new AccessError(400, "No se pudo enviar la invitacion. El correo puede estar registrado; verifica la configuracion de Auth.");
  // Never overwrite an existing profile or accept role/parish from user_metadata.
  const inserted = await admin.from("profiles").insert({ id: data.user.id, parish_id: context.profile.parish_id,
    email: input.email, full_name: input.full_name, role: input.role, active: input.active, person_id: input.person_id });
  if (inserted.error) throw new AccessError(503, "La invitacion se envio, pero no se pudo preparar el perfil. El acceso queda bloqueado hasta que un administrador repare el perfil.");
  return { id: data.user.id };
}
export async function updateAppUser(context: Context, body: unknown) {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new AccessError(400, "Datos invalidos. El email y la parroquia no se pueden modificar aqui.");
  const { id, ...patch } = parsed.data;
  const target = await context.client.from("profiles").select("id").eq("id", id).eq("parish_id", context.profile.parish_id).maybeSingle();
  dbError(target.error);
  if (!target.data) throw new AccessError(404, "Usuario no encontrado en tu parroquia.");
  await validatePerson(context, patch.person_id, id);
  const result = await context.client.from("profiles").update(patch).eq("id", id).eq("parish_id", context.profile.parish_id).select("id").maybeSingle();
  dbError(result.error);
  if (!result.data) throw new AccessError(404, "Usuario no encontrado en tu parroquia.");
  return result.data;
}
