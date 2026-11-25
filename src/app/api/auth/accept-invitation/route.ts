import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { AccessError, apiError, requireSameOrigin } from "@/lib/admin-access";

const schema = z.object({
  phone: z.string().min(10).max(30),
  code: z.string().min(12).max(50),
  password: z.string().min(8).max(72),
  password_confirmation: z.string().min(8).max(72),
}).strict();

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  return national.length === 10 ? `+52${national}` : null;
}
function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}
function hashCode(value: string) {
  return createHash("sha256").update(normalizeCode(value)).digest("hex");
}
function invalidInvite() {
  return new AccessError(400, "El código no es válido, venció o no corresponde a ese celular.");
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    let body: unknown;
    try { body = await request.json(); } catch { throw new AccessError(400, "Solicitud inválida."); }
    const parsed = schema.safeParse(body);
    if (!parsed.success || parsed.data.password !== parsed.data.password_confirmation) {
      throw new AccessError(400, "Revisa el código, celular y contraseñas.");
    }
    const phone = normalizePhone(parsed.data.phone);
    if (!phone) throw new AccessError(400, "Captura un celular mexicano de 10 dígitos.");
    const codeHash = hashCode(parsed.data.code);
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const found = await admin.from("phone_invitations")
      .select("id,parish_id,profile_id,full_name,email,role,active,person_id,phone,expires_at,redeemed_at,revoked_at,claimed_at")
      .eq("code_hash", codeHash).eq("phone", phone).maybeSingle();
    if (found.error || !found.data || found.data.redeemed_at || found.data.revoked_at || found.data.expires_at <= now) {
      throw invalidInvite();
    }
    const claimed = await admin.from("phone_invitations").update({ claimed_at: now })
      .eq("id", found.data.id).eq("code_hash", codeHash).is("redeemed_at", null).is("revoked_at", null)
      .is("claimed_at", null).gt("expires_at", now).select("id").maybeSingle();
    if (claimed.error || !claimed.data) throw invalidInvite();

    if (found.data.profile_id) {
      const profile = await admin.from("profiles").select("id,active,parish_id,role")
        .eq("id", found.data.profile_id).eq("parish_id", found.data.parish_id).maybeSingle();
      if (profile.error || !profile.data || !profile.data.active) {
        await admin.from("phone_invitations").update({ claimed_at: null }).eq("id", found.data.id).is("redeemed_at", null);
        throw invalidInvite();
      }
      const authUpdate = await admin.auth.admin.updateUserById(found.data.profile_id, {
        phone, phone_confirm: true, password: parsed.data.password,
      });
      if (authUpdate.error) {
        await admin.from("phone_invitations").update({ claimed_at: null }).eq("id", found.data.id).is("redeemed_at", null);
        throw invalidInvite();
      }
      const profileUpdate = await admin.from("profiles").update({
        phone_contact: phone, phone_verified_at: new Date().toISOString(),
      }).eq("id", found.data.profile_id).eq("parish_id", found.data.parish_id);
      if (profileUpdate.error) {
        await admin.from("phone_invitations").update({ redeemed_at: new Date().toISOString() }).eq("id", found.data.id);
        throw new AccessError(503, "Se activó la credencial, pero no se pudo actualizar el perfil. Contacta al administrador.");
      }
    } else {
      const created = await admin.auth.admin.createUser({
        phone, phone_confirm: true, password: parsed.data.password,
        user_metadata: { full_name: found.data.full_name },
      });
      if (created.error || !created.data.user) {
        await admin.from("phone_invitations").update({ claimed_at: null }).eq("id", found.data.id).is("redeemed_at", null);
        throw invalidInvite();
      }
      const inserted = await admin.from("profiles").insert({
        id: created.data.user.id, parish_id: found.data.parish_id, full_name: found.data.full_name,
        email: found.data.email, role: found.data.role, active: found.data.active,
        person_id: found.data.person_id, phone_contact: phone, phone_verified_at: new Date().toISOString(),
      });
      if (inserted.error) {
        await admin.auth.admin.deleteUser(created.data.user.id);
        await admin.from("phone_invitations").update({ claimed_at: null }).eq("id", found.data.id).is("redeemed_at", null);
        throw new AccessError(409, "No se pudo crear el perfil; solicita un código nuevo al administrador.");
      }
    }
    const redeemed = await admin.from("phone_invitations").update({ redeemed_at: new Date().toISOString() })
      .eq("id", found.data.id).eq("claimed_at", now).is("redeemed_at", null).select("id").maybeSingle();
    if (redeemed.error || !redeemed.data) {
      throw new AccessError(503, "La cuenta se preparó, pero no se confirmó el uso del código. Contacta al administrador.");
    }
    return Response.json({ accepted: true });
  } catch (error) {
    if (error instanceof AccessError) return apiError(error);
    console.error("Invitation acceptance failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "No se pudo aceptar la invitación. Solicita ayuda al administrador." }, { status: 500 });
  }
}
