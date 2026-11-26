import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { APP_PERMISSIONS, APP_PERMISSION_KEYS, APP_ROLES, type AppRole } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { AccessError, type requireAdmin } from "@/lib/admin-access";
const phoneContact = z.union([z.string().trim().max(40), z.null()]).optional().transform((value) => {
  if (value === undefined || value === null || value === "") return null;
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 13 && digits.startsWith("521") ? digits.slice(3)
    : digits.length === 12 && digits.startsWith("52") ? digits.slice(2)
    : digits.length === 10 ? digits : "";
  return national.length === 10 ? `+52${national}` : "__invalid_phone__";
}).pipe(z.union([z.null(), z.string().regex(/^\+52[0-9]{10}$/, "Ingresa un celular mexicano de 10 dígitos.")]));
const permissionOverrides = z.array(z.object({
  permission_key: z.enum(APP_PERMISSION_KEYS),
  allowed: z.boolean(),
}).strict()).max(APP_PERMISSIONS.length).optional().superRefine((overrides, context) => {
  if (!overrides) return;
  const keys = new Set<string>();
  for (const override of overrides) {
    if (keys.has(override.permission_key)) context.addIssue({ code: "custom", message: "Permiso duplicado." });
    keys.add(override.permission_key);
  }
});
const fields = { full_name: z.string().trim().min(1).max(150), role: z.enum(APP_ROLES),
  active: z.boolean(), person_id: z.guid().nullable(), phone_contact: phoneContact };
const inviteSchema = z.object({ ...fields, active: z.boolean().default(true), person_id: z.union([z.guid(), z.literal(""), z.null()]).optional().transform((value) => value || null), email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()) }).strict();
const updateSchema = z.object({ ...fields, permission_overrides: permissionOverrides, id: z.string().uuid() }).strict();
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
async function findAuthUserByEmail(admin: ReturnType<typeof authAdmin>, email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new AccessError(503, "No se pudo verificar si el correo ya tiene una cuenta.");
    const user = data.users.find((item) => item.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
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
    context.client.from("profiles").select("id,full_name,email,role,active,person_id,phone_contact,phone_verified_at", { count: "exact" }).eq("parish_id", context.profile.parish_id).order("created_at").order("id").range(start, start + 49),
    listParishPeople(context),
  ]);
  if (profiles.error) throw new AccessError(503, "No se pudo cargar usuarios y servidores.");
  const ids = (profiles.data ?? []).map((profile) => profile.id);
  const overrides = ids.length ? await context.client.from("profile_permission_overrides")
    .select("profile_id,permission_key,allowed").in("profile_id", ids) : { data: [], error: null };
  if (overrides.error) throw new AccessError(503, "No se pudieron cargar los permisos de usuarios. Revisa las migraciones.");
  const permissionMap = new Map<string, { permission_key: string; allowed: boolean }[]>();
  for (const override of overrides.data ?? []) {
    permissionMap.set(override.profile_id, [...(permissionMap.get(override.profile_id) ?? []), {
      permission_key: override.permission_key, allowed: override.allowed,
    }]);
  }
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ? authAdmin() : null;
  const users = await Promise.all((profiles.data ?? []).map(async (profile) => {
    const base = { ...profile, permission_overrides: permissionMap.get(profile.id) ?? [] };
    if (!admin) return { ...base, last_sign_in_at: null, pending_invitation: null };
    try {
      const { data, error } = await admin.auth.admin.getUserById(profile.id);
      if (error || !data.user) return { ...base, last_sign_in_at: null, pending_invitation: null };
      return { ...base, last_sign_in_at: data.user.last_sign_in_at ?? null,
        pending_invitation: !!data.user.invited_at && !data.user.last_sign_in_at && !data.user.email_confirmed_at };
    } catch {
      return { ...base, last_sign_in_at: null, pending_invitation: null };
    }
  }));
  return { users, people, total: profiles.count ?? 0, invitationsConfigured: !!admin, actorId: context.actorId };
}
export async function inviteAppUser(context: Context, body: unknown) {
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path[0];
    const detail = field === "email" ? "Ingresa un email valido (nombre@dominio.com)."
      : field === "full_name" ? "Ingresa el nombre del usuario (maximo 150 caracteres)."
      : field === "role" ? "Selecciona un rol valido."
      : field === "person_id" ? "Selecciona un servidor valido de la lista o deja Sin vincular."
      : field === "active" ? "El estado del usuario debe ser valido."
      : field === "phone_contact" ? "Ingresa un celular mexicano de 10 dígitos o deja el campo vacío."
      : "La solicitud contiene campos no permitidos; no envies parroquia.";
    throw new AccessError(400, detail);
  }
  const input = parsed.data;
  await validatePerson(context, input.person_id);
  const duplicate = await context.client.from("profiles").select("id").eq("parish_id", context.profile.parish_id).eq("email", input.email).maybeSingle();
  dbError(duplicate.error);
  if (duplicate.data) throw new AccessError(409, "Este usuario ya tiene acceso a la parroquia.");
  const admin = authAdmin();
  const existingAuthUser = await findAuthUserByEmail(admin, input.email);
  if (existingAuthUser) {
    const existingProfile = await admin.from("profiles").select("id").eq("id", existingAuthUser.id).maybeSingle();
    dbError(existingProfile.error);
    if (existingProfile.data) throw new AccessError(409, "La cuenta ya está vinculada. No se creó otro usuario.");
    const inserted = await admin.from("profiles").insert({ id: existingAuthUser.id, parish_id: context.profile.parish_id,
      email: input.email, full_name: input.full_name, role: input.role, active: input.active, person_id: input.person_id, phone_contact: input.phone_contact });
    if (inserted.error) throw new AccessError(503, "No se pudo vincular la cuenta existente. No se modificó la cuenta de Auth.");
    return { id: existingAuthUser.id, linked: true };
  }
  const configured = process.env.APP_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3100" : "");
  let site: URL;
  try { site = new URL(configured); } catch { throw new AccessError(503, "Configura APP_URL en el servidor para las invitaciones."); }
  if (site.protocol !== "https:" && !(site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname))) throw new AccessError(503, "APP_URL debe usar HTTPS.");
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.full_name }, redirectTo: new URL("/auth/callback", site.origin).href,
  });
  if (error || !data.user) throw new AccessError(400, "No se pudo enviar la invitacion. El correo puede estar registrado; verifica la configuracion de Auth.");
  // Never overwrite an existing profile or accept role/parish from user_metadata.
  const inserted = await admin.from("profiles").insert({ id: data.user.id, parish_id: context.profile.parish_id,
    email: input.email, full_name: input.full_name, role: input.role, active: input.active, person_id: input.person_id, phone_contact: input.phone_contact });
  if (inserted.error) throw new AccessError(503, "La invitacion se envio, pero no se pudo preparar el perfil. El acceso queda bloqueado hasta que un administrador repare el perfil.");
  return { id: data.user.id };
}
const phoneInvitationSchema = z.object({
  profile_id: z.guid().optional(),
  full_name: z.string().trim().min(1).max(150).optional(),
  email: z.union([z.string().trim().email().max(254), z.literal(""), z.null()]).optional(),
  role: z.enum(APP_ROLES).optional(),
  active: z.boolean().optional(),
  person_id: z.union([z.guid(), z.literal(""), z.null()]).optional().transform((value) => value || null),
  phone_contact: phoneContact,
}).strict();

function normalizedInviteCode(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

export async function createPhoneInvitation(context: Context, body: unknown) {
  const parsed = phoneInvitationSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path[0];
    const detail = field === "phone_contact" ? "Ingresa un celular mexicano de 10 dígitos."
      : field === "full_name" ? "Ingresa el nombre del usuario (máximo 150 caracteres)."
      : field === "role" ? "Selecciona un rol válido."
      : field === "person_id" ? "Selecciona un servidor válido de la lista o deja Sin vincular."
      : "La solicitud contiene campos no permitidos.";
    throw new AccessError(400, detail);
  }
  const input = parsed.data;
  if (!input.profile_id && input.role === "ADMIN") {
    throw new AccessError(400, "ADMIN debe usar correo y contraseña; no se puede invitar con celular.");
  }
  const admin = authAdmin();
  let profileId = input.profile_id ?? null;
  let invite = {
    full_name: input.full_name ?? "",
    email: input.email || null,
    role: input.role ?? "SERVIDOR" as AppRole,
    active: input.active ?? true,
    person_id: input.person_id,
    phone_contact: input.phone_contact ?? null,
  };

  if (profileId) {
    const existing = await context.client.from("profiles")
      .select("id,full_name,email,role,active,person_id,phone_contact")
      .eq("id", profileId).eq("parish_id", context.profile.parish_id).maybeSingle();
    dbError(existing.error);
    if (!existing.data) throw new AccessError(404, "Usuario no encontrado en tu parroquia.");
    if (existing.data.role === "ADMIN") throw new AccessError(400, "La cuenta ADMIN conserva acceso por email y contraseña.");
    if (!existing.data.active) throw new AccessError(400, "Reactiva el usuario antes de crear una invitación.");
    invite = {
      full_name: existing.data.full_name ?? "",
      email: existing.data.email,
      role: existing.data.role,
      active: existing.data.active,
      person_id: existing.data.person_id,
      phone_contact: input.phone_contact ?? existing.data.phone_contact,
    };
  } else if (!invite.full_name || !input.role || invite.active !== true) {
    throw new AccessError(400, "Para invitar un usuario nuevo, captura nombre y rol y déjalo activo.");
  }

  const phone = invite.phone_contact;
  if (!phone) throw new AccessError(400, "Captura primero el celular del usuario.");
  await validatePerson(context, invite.person_id, profileId ?? undefined);
  let duplicateQuery = context.client.from("profiles").select("id")
    .eq("parish_id", context.profile.parish_id).eq("phone_contact", phone);
  if (profileId) duplicateQuery = duplicateQuery.neq("id", profileId);
  const duplicatePhone = await duplicateQuery.maybeSingle();
  dbError(duplicatePhone.error);
  if (duplicatePhone.data) throw new AccessError(409, "Ese celular ya está asignado a otro usuario.");

  const code = randomBytes(18).toString("base64url").toUpperCase();
  const codeHash = createHash("sha256").update(normalizedInviteCode(code)).digest("hex");
  const revoke = await admin.from("phone_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("parish_id", context.profile.parish_id).eq("phone", phone).is("redeemed_at", null).is("revoked_at", null);
  if (revoke.error) throw new AccessError(503, "No se pudo reemplazar una invitación anterior.");
  const inserted = await admin.from("phone_invitations").insert({
    parish_id: context.profile.parish_id,
    profile_id: profileId,
    full_name: invite.full_name,
    email: invite.email,
    role: invite.role,
    active: invite.active,
    person_id: invite.person_id,
    phone,
    code_hash: codeHash,
    created_by: context.actorId,
  }).select("id,expires_at").single();
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === "23505") throw new AccessError(409, "Ya existe una invitación activa para ese celular.");
    throw new AccessError(503, "No se pudo crear el código de invitación. Revisa la migración.");
  }
  const groupedCode = code.match(/.{1,4}/g)?.join("-") ?? code;
  return { id: inserted.data.id, code: groupedCode, phone, full_name: invite.full_name, expires_at: inserted.data.expires_at };
}

export async function updateAppUser(context: Context, body: unknown) {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new AccessError(400, "Datos invalidos. El email y la parroquia no se pueden modificar aqui.");
  const { id, permission_overrides, ...patch } = parsed.data;
  const target = await context.client.from("profiles").select("id").eq("id", id).eq("parish_id", context.profile.parish_id).maybeSingle();
  dbError(target.error);
  if (!target.data) throw new AccessError(404, "Usuario no encontrado en tu parroquia.");
  await validatePerson(context, patch.person_id, id);
  if (permission_overrides !== undefined && id === context.actorId) throw new AccessError(400, "No puedes modificar tus propios permisos.");
  const result = await context.client.rpc("admin_update_app_user", {
    p_profile_id: id, p_full_name: patch.full_name, p_role: patch.role, p_active: patch.active,
    p_person_id: patch.person_id, p_phone_contact: patch.phone_contact,
    p_permission_overrides: permission_overrides ?? null,
  });
  dbError(result.error);
  if (result.error) throw new AccessError(503, "No se pudo guardar el usuario. Revisa las migraciones y los permisos.");
  if (!result.data) throw new AccessError(404, "Usuario no encontrado en tu parroquia.");
  return { id: result.data };
}
