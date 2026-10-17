"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
export default function PasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }
    setBusy(true);
    try {
      const client = createClient();
      if (!client) throw new Error("Supabase no esta configurado.");
      const { data } = await client.auth.getUser();
      if (!data.user) throw new Error("Inicia sesion desde tu invitacion.");
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      window.location.replace("/comisiones");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo establecer tu contraseña."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-md p-6"><form className="card-panel space-y-4 p-6" onSubmit={save}><h1 className="text-2xl font-bold">Establecer mi contraseña</h1><label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)}/></label><label>Confirmar contraseña<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)}/></label>{error && <p role="alert" className="text-red-800">{error}</p>}<button className="primary" disabled={busy}>{busy ? "Guardando..." : "Guardar y entrar"}</button></form></main>;
}
