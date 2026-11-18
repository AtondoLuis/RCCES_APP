"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_PERMISSIONS, type AppPermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { ModuleShell } from "@/components/module-shell";

type UserPermissionRow = {
  profile_id: string;
  full_name: string | null;
  role: string;
  active: boolean;
  permission_overrides: { permission_key: AppPermission; allowed: boolean }[];
};
type AuditRow = { target_profile_id: string; permission_key: AppPermission; old_allowed: boolean | null; new_allowed: boolean | null; created_at: string };

export default function UserPermissionsAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<UserPermissionRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase no está configurado."); setLoading(false); return; }
    const [usersResult, auditResult] = await Promise.all([
      supabase.rpc("list_permission_profiles"),
      supabase.from("permission_audit").select("target_profile_id,permission_key,old_allowed,new_allowed,created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    const firstError = usersResult.error ?? auditResult.error;
    if (firstError) setError(firstError.message);
    else {
      setUsers((usersResult.data ?? []) as UserPermissionRow[]);
      setAudit((auditResult.data ?? []) as AuditRow[]);
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(user: UserPermissionRow, permissionKey: AppPermission, value: string) {
    if (!supabase || busy) return;
    setBusy(user.profile_id); setError(""); setMessage("");
    const permission_overrides = user.permission_overrides.filter((item) => item.permission_key !== permissionKey);
    if (value) permission_overrides.push({ permission_key: permissionKey, allowed: value === "allow" });
    const result = await supabase.rpc("set_profile_permission_overrides", {
      p_profile_id: user.profile_id,
      p_overrides: permission_overrides,
    });
    if (result.error) setError(result.error.message);
    else {
      setUsers((current) => current.map((item) => item.profile_id === user.profile_id ? { ...item, permission_overrides } : item));
      setMessage(`Permiso actualizado para ${user.full_name || "el usuario"}.`);
      await load();
    }
    setBusy("");
  }

  const names = new Map(users.map((user) => [user.profile_id, user.full_name || "Usuario"]));
  return <ModuleShell><section className="space-y-5">
    <header className="card-panel p-4 sm:p-6"><h1 className="text-2xl font-bold">Permisos de usuarios</h1><p className="mt-2 text-sm text-slate-600">Concede, deniega o devuelve a la política del rol. No puedes cambiar tus propios permisos.</p></header>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="text-emerald-800">{message}</p>}
    {loading ? <p role="status" className="card-panel p-4">Cargando usuarios...</p> : <section className="space-y-3">
      {users.map((user) => <article className="card-panel p-4 sm:p-5" key={user.profile_id}>
        <div className="mb-4 flex flex-wrap items-center gap-2"><h2 className="font-bold">{user.full_name || "Sin nombre"}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{user.role}</span><span className={`text-xs font-semibold ${user.active ? "text-emerald-700" : "text-red-700"}`}>{user.active ? "Activo" : "Inactivo"}</span></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{APP_PERMISSIONS.map(({ key, label }) => {
          const override = user.permission_overrides.find((item) => item.permission_key === key);
          return <label className="text-sm" key={key}>{label}<select className="mt-1" disabled={busy !== ""} value={override ? override.allowed ? "allow" : "deny" : ""} onChange={(event) => void save(user, key, event.target.value)}>
            <option value="">Usar permiso del rol</option><option value="allow">Conceder</option><option value="deny">Denegar</option>
          </select></label>;
        })}</div>
      </article>)}
      {!users.length && <p className="card-panel p-4">No hay otros usuarios que administrar.</p>}
    </section>}
    <section className="card-panel p-4 sm:p-6"><h2 className="mb-3 text-lg font-bold">Auditoría de permisos</h2>
      {!audit.length ? <p className="text-sm text-slate-600">No hay cambios registrados.</p> : <div className="space-y-2">{audit.map((entry, index) => {
        const label = APP_PERMISSIONS.find((permission) => permission.key === entry.permission_key)?.label ?? entry.permission_key;
        const state = (value: boolean | null) => value === null ? "Heredado" : value ? "Concedido" : "Denegado";
        return <article className="border-t py-2 text-sm" key={`${entry.target_profile_id}-${entry.permission_key}-${entry.created_at}-${index}`}>
          <b>{names.get(entry.target_profile_id) ?? "Usuario"}</b> · {label}: {state(entry.old_allowed)} → {state(entry.new_allowed)}
          <span className="block text-xs text-slate-500">{new Date(entry.created_at).toLocaleString("es-MX")}</span>
        </article>;
      })}</div>}
    </section>
  </section></ModuleShell>;
}
