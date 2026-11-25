"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/dashboard";
import { APP_PERMISSIONS, APP_ROLES, type AppPermission, type AppRole } from "@/lib/permissions";

type UserRow = { id: string; full_name: string | null; email: string | null; role: AppRole; active: boolean; person_id: string | null; phone_contact: string | null; phone_verified_at: string | null; permission_overrides: { permission_key: AppPermission; allowed: boolean }[]; last_sign_in_at: string | null; pending_invitation: boolean | null };
type PersonOption = { id: string; first_name: string; last_name: string; display_name: string | null };
type GeneratedInvitation = { code: string; phone: string; full_name: string; expires_at: string };
type Form = { id?: string; full_name: string; email: string; role: AppRole; active: boolean; person_id: string; phone_contact: string; permission_overrides: { permission_key: AppPermission; allowed: boolean }[] };
const emptyForm: Form = { full_name: "", email: "", role: "SERVIDOR", active: true, person_id: "", phone_contact: "", permission_overrides: [] };
const inputClass = "w-full";
export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invitationsConfigured, setInvitationsConfigured] = useState(false);
  const [actorId, setActorId] = useState("");
  const [generatedInvitation, setGeneratedInvitation] = useState<GeneratedInvitation | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/admin/usuarios?page=${page}`, { signal, cache: "no-store" });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar usuarios.");
      setUsers(data.users); setPeople(data.people); setTotal(data.total); setInvitationsConfigured(data.invitationsConfigured); setActorId(data.actorId);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar usuarios."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [page]);
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);
  const personName = (id: string | null) => { const person = people.find((p) => p.id === id); return person ? person.display_name || `${person.first_name} ${person.last_name}` : id ? "Servidor vinculado" : "Sin vincular"; };
  async function save(values: Form) {
    if (busy) return;
    setBusy(true); setError(""); setMessage(""); setGeneratedInvitation(null);
    try {
      const base = { full_name: values.full_name, role: values.role, active: values.active,
        person_id: values.person_id || null, phone_contact: values.phone_contact };
      const payload = values.id
        ? { ...base, id: values.id, ...(values.id !== actorId ? { permission_overrides: values.permission_overrides } : {}) }
        : { ...base, email: values.email.trim() || null };
      const response = await fetch("/api/admin/usuarios", {
        method: values.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar el usuario.");
      setForm(null);
      if (values.id) {
        setMessage("Usuario actualizado.");
      } else {
        setGeneratedInvitation(result);
        setMessage("Código creado. Compártelo con el usuario por WhatsApp.");
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el usuario."); }
    finally { setBusy(false); }
  }
  async function generateInvitation(user: UserRow) {
    if (busy) return;
    setBusy(true); setError(""); setMessage(""); setGeneratedInvitation(null);
    try {
      const response = await fetch("/api/admin/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: user.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo crear el código.");
      setGeneratedInvitation(result);
      setMessage("Código creado. Compártelo con el usuario por WhatsApp.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear el código."); }
    finally { setBusy(false); }
  }
  async function copyInvitationCode() {
    if (!generatedInvitation) return;
    try {
      await navigator.clipboard.writeText(generatedInvitation.code);
      setMessage("Código copiado.");
    } catch {
      setError("No se pudo copiar el código. Selecciónalo y cópialo manualmente.");
    }
  }
  function toggle(user: UserRow) {
    if (window.confirm(`¿${user.active ? "Desactivar" : "Reactivar"} el acceso de ${user.full_name || user.email}?`)) void save({ ...user, full_name: user.full_name || "", email: user.email || "", person_id: user.person_id || "", phone_contact: user.phone_contact || "", active: !user.active });
  }
  return <Shell role="ADMIN"><section className="card-panel p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Usuarios de la app</h1><button className="primary" disabled={busy || !invitationsConfigured} onClick={() => { setForm({ ...emptyForm }); setError(""); }}>+ Nuevo usuario</button></div>
    {!invitationsConfigured && !loading && <p className="mb-4 text-sm text-amber-800">Las invitaciónes y el último acceso requieren configurar la clave de administración en el servidor.</p>}
    {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mb-4 text-emerald-800">{message}</p>}
    {generatedInvitation && <div className="mb-5 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
      <p className="font-bold">Código para {generatedInvitation.full_name}</p>
      <p className="text-sm text-slate-700">Celular: {generatedInvitation.phone}</p>
      <div className="my-3 flex flex-wrap items-center gap-2"><code className="break-all rounded bg-white px-3 py-2 text-lg font-bold tracking-wider">{generatedInvitation.code}</code><button type="button" onClick={() => void copyInvitationCode()}>Copiar código</button></div>
      <p className="text-sm text-slate-700">Vence: {new Date(generatedInvitation.expires_at).toLocaleString("es-MX")}. El código se muestra una sola vez; si se pierde, crea otro para reemplazarlo.</p>
      <button type="button" className="mt-3" onClick={() => setGeneratedInvitation(null)}>Cerrar</button>
    </div>}
    {form && <form className="mb-6 space-y-4 rounded-lg border bg-slate-50 p-4" onSubmit={(e) => { e.preventDefault(); void save(form); }}>
      <h2 className="text-lg font-bold">{form.id ? "Editar usuario" : "Invitar usuario"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Nombre<input className={inputClass} required maxLength={150} disabled={busy} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}/></label>
        <label>Email de contacto (opcional)<input className={inputClass} type="email" disabled={busy || !!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/></label>
        <label>Rol<select className={inputClass} disabled={busy} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>{APP_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label>
        <label>Servidor vinculado (opcional)<select className={inputClass} disabled={busy} value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })}><option value="">Sin vincular</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name || `${p.first_name} ${p.last_name}`}</option>)}</select></label>
        <label>Celular para iniciar sesión<input className={inputClass} type="tel" inputMode="tel" autoComplete="tel" placeholder="+52 664 123 4567" required={!form.id} disabled={busy} value={form.phone_contact} onChange={(e) => setForm({ ...form, phone_contact: e.target.value })}/><span className="text-xs font-normal text-slate-500">El usuario aceptará una invitación de un solo uso y creará su contraseña.</span></label>
      </div>
      {form.id && form.id !== actorId && <fieldset className="rounded-lg border bg-white p-3"><legend className="px-1 font-bold">Permisos individuales</legend><p className="mb-3 text-sm text-slate-600">“Usar permiso del rol” quita la excepción; conceder o denegar sustituye el valor del rol.</p><div className="grid gap-3 sm:grid-cols-2">{APP_PERMISSIONS.map(({ key, label }) => {
        const override = form.permission_overrides.find((item) => item.permission_key === key);
        return <label key={key} className="text-sm">{label}<select className={inputClass} disabled={busy} value={override ? override.allowed ? "allow" : "deny" : ""} onChange={(e) => {
          const permission_overrides = form.permission_overrides.filter((item) => item.permission_key !== key);
          if (e.target.value) permission_overrides.push({ permission_key: key, allowed: e.target.value === "allow" });
          setForm({ ...form, permission_overrides });
        }}><option value="">Usar permiso del rol</option><option value="allow">Conceder</option><option value="deny">Denegar</option></select></label>;
      })}</div></fieldset>}
      <label className="checkbox-field"><input disabled={busy} type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/><span>Activo</span></label>
      <p className="text-sm text-slate-600">Al crear un usuario se genera un código único, válido por 7 días. Compártelo por WhatsApp; el usuario lo acepta en RCCES_APP y define su contraseña.</p>
      <div className="flex flex-wrap gap-2"><button className="primary" disabled={busy}>{busy ? "Guardando..." : form.id ? "Guardar cambios" : "Crear código de invitación"}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancelar</button></div>
    </form>}
    {loading ? <p role="status">Cargando usuarios...</p> : <>
      <div className="hidden grid-cols-[1.3fr_1.5fr_1fr_1fr_1.3fr_1.2fr_1.5fr] gap-3 border-b pb-3 text-sm font-bold lg:grid"><span>Nombre</span><span>Email</span><span>Rol</span><span>Estado</span><span>Servidor vinculado</span><span>Último acceso</span><span>Acciones</span></div>
      <div className="space-y-3 lg:space-y-0">{users.map((user) => <article key={user.id} className="grid gap-3 rounded-lg border p-4 text-sm lg:grid-cols-[1.3fr_1.5fr_1fr_1fr_1.3fr_1.2fr_1.5fr] lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-0">
        <b className="break-words">{user.full_name || "Sin nombre"}</b><span className="break-all">{user.email || "Sin email"}</span><span>{user.role}</span>
        <span className="font-semibold">{!user.active ? "Inactivo" : user.role === "ADMIN" ? "Activo · correo" : user.phone_verified_at ? "Activo · celular" : "Pendiente de activar celular"}</span>
        <span>{personName(user.person_id)}<br/><span className="text-xs text-slate-500">{user.phone_contact || "Sin celular"} · {user.phone_verified_at ? "Verificado" : "No verificado"}</span></span><span>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("es-MX") : "No disponible"}</span>
        <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => { setForm({ ...user, full_name: user.full_name || "", email: user.email || "", person_id: user.person_id || "", phone_contact: user.phone_contact || "", permission_overrides: user.permission_overrides || [] }); setError(""); }}>Editar</button>{user.role !== "ADMIN" && <button disabled={busy || !user.phone_contact} title={!user.phone_contact ? "Captura primero un celular" : undefined} onClick={() => void generateInvitation(user)}>Crear código</button>}<button disabled={busy} onClick={() => toggle(user)}>{user.active ? "Desactivar" : "Reactivar"}</button></div>
      </article>)}</div>
      {!users.length && <p className="py-4">No hay usuarios para mostrar.</p>}
      <div className="mt-5 flex items-center gap-3"><button disabled={page === 0 || busy} onClick={() => { setLoading(true); setError(""); setPage(page - 1); }}>Anterior</button><span>Página {page + 1} · {total} usuarios</span><button disabled={(page + 1) * 50 >= total || busy} onClick={() => { setLoading(true); setError(""); setPage(page + 1); }}>Siguiente</button></div>
    </>}
  </section></Shell>;
}
