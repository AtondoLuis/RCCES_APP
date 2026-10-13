"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!supabase) { setError("Supabase no está configurado."); return; }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) { setError(signInError.message); return; }
    router.replace("/"); router.refresh();
  }
  return <main className="grid min-h-screen place-items-center bg-[#f7f8fa] px-4"><form onSubmit={submit} className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm"><h1 className="mb-5 text-2xl font-black text-[#13263d]">Iniciar sesión</h1><label className="mb-3 block text-sm font-bold">Email<input className="mt-1 w-full rounded-lg border px-3 py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label className="mb-4 block text-sm font-bold">Contraseña<input className="mt-1 w-full rounded-lg border px-3 py-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}<button className="min-h-11 w-full rounded-lg bg-[#13263d] font-bold text-white">Entrar</button></form></main>;
}

