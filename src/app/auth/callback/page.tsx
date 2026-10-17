"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
export default function AuthCallback() {
  const [error, setError] = useState("");
  const operation = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function complete() {
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      window.history.replaceState(null, "", "/auth/callback");
      const client = createClient();
      if (!client) throw new Error("Supabase no esta configurado.");
      if (url.searchParams.get("error") || fragment.get("error")) throw new Error("El enlace de invitacion no es valido o ha vencido.");
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      if (code) {
        const result = await client.auth.exchangeCodeForSession(code);
        if (result.error) throw new Error("No se pudo verificar el enlace de acceso.");
      } else if (tokenHash && url.searchParams.get("type") === "invite") {
        const result = await client.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
        if (result.error) throw new Error("La invitacion no es valida o ha vencido.");
      } else if (fragment.get("access_token") && fragment.get("refresh_token")) {
        const result = await client.auth.setSession({ access_token: fragment.get("access_token")!, refresh_token: fragment.get("refresh_token")! });
        if (result.error) throw new Error("No se pudo iniciar la sesion de invitacion.");
      } else throw new Error("Falta un enlace de invitacion valido.");
      const { data, error: authError } = await client.auth.getUser();
      if (authError || !data.user) throw new Error("No se pudo verificar la cuenta.");
      const profile = await client.from("profiles").select("active,parish_id").eq("id", data.user.id).maybeSingle();
      if (profile.error || !profile.data?.active || !profile.data.parish_id) {
        await client.auth.signOut();
        throw new Error("Tu acceso esta desactivado o tu perfil aun no esta preparado. Contacta a tu administrador.");
      }

    }
    operation.current ??= complete();
    void operation.current.then(() => { if (!cancelled) window.location.replace("/auth/password"); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo completar la invitacion."); });
    return () => { cancelled = true; };
  }, []);
  return <main className="mx-auto max-w-md p-6"><h1 className="text-2xl font-bold">Acceso a RCCES</h1>{error ? <><p role="alert" className="my-4 text-red-800">{error}</p><Link href="/login">Volver a iniciar sesion</Link></> : <p role="status">Verificando invitacion...</p>}</main>;
}
