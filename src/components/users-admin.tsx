"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/dashboard";
import { APP_ROLES, type AppRole } from "@/lib/permissions";

type UserRow = { id: string; full_name: string | null; email: string | null; role: AppRole; active: boolean; person_id: string | null; last_sign_in_at: string | null; pending_invitation: boolean | null };
type PersonOption = { id: string; first_name: string; last_name: string; display_name: string | null };
type Form = { id?: string; full_name: string; email: string; role: AppRole; active: boolean; person_id: string };
const emptyForm: Form = { full_name: "", email: "", role: "LECTOR", active: true, person_id: "" };
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
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/admin/usuarios?page=${page}`, { signal, cache: "no-store" });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar usuarios.");
      setUsers(data.users); setPeople(data.people); setTotal(data.total); setInvitationsConfigured(data.invitationsConfigured);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar usuarios."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [page]);
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load]);
  const personName = (id: string | null) => { const person = people.find((p) => p.id === id); return person ? person.display_name || `${person.first_name} ${person.last_name}` : id ? "Servidor vinculado" : "Sin vincular"; };
  async function save(values: Form) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = { full_name: values.full_name, role: values.role, active: values.active, person_id: values.person_id || null,
        ...(values.id ? { id: values.id } : { email: values.email }) };
      const response = await fetch("/api/admin/usuarios", { method: values.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar el usuario.");
      setForm(null); setMessage(values.id ? "Usuario actualizado." : "Invitación enviada. El usuario recibirá un enlace para establecer su acceso."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el usuario."); }
    finally { setBusy(false); }
  }
  function toggle(user: UserRow) {
    if (window.confirm(`¿${user.active ? "Desactivar" : "Reactivar"} el acceso de ${user.full_name || user.email}?`)) void save({ ...user, full_name: user.full_name || "", email: user.email || "", person_id: user.person_id || "", active: !user.active });
  }
  return <Shell role="ADMIN"><section className="card-panel p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Usuarios de la app</h1><button className="primary" disabled={busy || !invitationsConfigured} onClick={() => { setForm({ ...emptyForm }); setError(""); }}>+ Nuevo usuario</button></div>
    {!invitationsConfigured && !loading && <p className="mb-4 text-sm text-amber-800">Las invitaciónes y el último acceso requieren configurar la clave de administración en el servidor.</p>}
    {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mb-4 text-emerald-800">{message}</p>}
    {form && <form className="mb-6 space-y-4 rounded-lg border bg-slate-50 p-4" onSubmit={(e) => { e.preventDefault(); void save(form); }}>
      <h2 className="text-lg font-bold">{form.id ? "Editar usuario" : "Invitar usuario"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Nombre<input className={inputClass} required maxLength={150} disabled={busy} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}/></label>
        <label>Email<input className={inputClass} type="email" required disabled={busy || !!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/></label>
        <label>Rol<select className={inputClass} disabled={busy} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>{APP_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label>
        <label>Servidor vinculado (opcional)<select className={inputClass} disabled={busy} value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })}><option value="">Sin vincular</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name || `${p.first_name} ${p.last_name}`}</option>)}</select></label>
      </div>
      <label className="checkbox-field"><input disabled={busy} type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/><span>Activo</span></label>
      <p className="text-sm text-slate-600">El usuario establece su propia contraseña mediante el enlace de invitación. El email no se modifica aquí.</p>
      <div className="flex flex-wrap gap-2"><button className="primary" disabled={busy}>{busy ? "Guardando..." : form.id ? "Guardar cambios" : "Enviar invitación"}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancelar</button></div>
    </form>}
    {loading ? <p role="status">Cargando usuarios...</p> : <>
      <div className="hidden grid-cols-[1.3fr_1.5fr_1fr_1fr_1.3fr_1.2fr_1.5fr] gap-3 border-b pb-3 text-sm font-bold lg:grid"><span>Nombre</span><span>Email</span><span>Rol</span><span>Estado</span><span>Servidor vinculado</span><span>Último acceso</span><span>Acciones</span></div>
      <div className="space-y-3 lg:space-y-0">{users.map((user) => <article key={user.id} className="grid gap-3 rounded-lg border p-4 text-sm lg:grid-cols-[1.3fr_1.5fr_1fr_1fr_1.3fr_1.2fr_1.5fr] lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-0">
        <b className="break-words">{user.full_name || "Sin nombre"}</b><span className="break-all">{user.email || "Sin email"}</span><span>{user.role}</span>
        <span className="font-semibold">{!user.active ? "Inactivo" : user.pending_invitation ? "Invitación pendiente" : "Activo"}</span>
        <span>{personName(user.person_id)}</span><span>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("es-MX") : "No disponible"}</span>
        <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => { setForm({ ...user, full_name: user.full_name || "", email: user.email || "", person_id: user.person_id || "" }); setError(""); }}>Editar</button><button disabled={busy} onClick={() => toggle(user)}>{user.active ? "Desactivar" : "Reactivar"}</button></div>
      </article>)}</div>
      {!users.length && <p className="py-4">No hay usuarios para mostrar.</p>}
      <div className="mt-5 flex items-center gap-3"><button disabled={page === 0 || busy} onClick={() => { setLoading(true); setError(""); setPage(page - 1); }}>Anterior</button><span>Página {page + 1} · {total} usuarios</span><button disabled={(page + 1) * 50 >= total || busy} onClick={() => { setLoading(true); setError(""); setPage(page + 1); }}>Siguiente</button></div>
    </>}
  </section></Shell>;
}
