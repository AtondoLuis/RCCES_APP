"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!supabase) {
      setError("Supabase no está configurado.");
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#eef3f6] px-4 py-8">
      <form onSubmit={submit} className="card-panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#9a7438]">RCCES</p>
          <h1 className="mt-1 text-2xl font-black text-[#13263d]">Iniciar sesión</h1>
          <p className="mt-2 text-sm text-slate-600">Accede con tu correo y contraseña para gestionar comisiones.</p>
        </div>
        <label className="mb-4 block">
          <span>Email</span>
          <input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="mb-5 block">
          <span>Contraseña</span>
          <input className="mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <button className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="submit">
          <LogIn /> Entrar
        </button>
      </form>
    </main>
  );
}
