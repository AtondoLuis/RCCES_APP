"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Method = "email" | "phone";
function normalizeMexicanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  return national.length === 10 ? `+52${national}` : null;
}
function safeAuthError() {
  return "No se pudo completar el acceso. Verifica tu celular o correo y contraseña.";
}

export default function DualLoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [method, setMethod] = useState<Method>("phone");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function redirectByProfile(loginMethod: Method) {
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { data: auth } = await supabase.auth.getUser();
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("active,parish_id,role").eq("id", auth.user?.id ?? "").maybeSingle();
    if (profileError || !profile?.active || !profile.parish_id) {
      await supabase.auth.signOut();
      throw new Error(profileError ? "No se pudo verificar tu perfil." : "Tu acceso está desactivado o no tienes un perfil autorizado.");
    }
    if (loginMethod === "email" && profile.role !== "ADMIN") {
      await supabase.auth.signOut();
      throw new Error("Esta cuenta debe iniciar sesión con celular y contraseña.");
    }
    router.replace(profile.role === "SERVIDOR" ? "/portal" : "/comisiones");
    router.refresh();
  }

  async function submitPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return setError("Supabase no está configurado.");
    const normalized = normalizeMexicanPhone(phone);
    if (!normalized) return setError("Captura un número celular mexicano de 10 dígitos.");
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ phone: normalized, password });
    if (signInError) {
      setBusy(false);
      return setError(safeAuthError());
    }
    try {
      await redirectByProfile("phone");
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : safeAuthError());
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return setError("Supabase no está configurado.");
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setBusy(false);
      return setError(safeAuthError());
    }
    try {
      await redirectByProfile("email");
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : safeAuthError());
    } finally {
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[#eef3f6] px-4 py-8">
    <section className="card-panel w-full max-w-md p-6 sm:p-8">
      <div className="mb-6">
        <p className="text-sm font-extrabold uppercase tracking-wide text-[#9a7438]">RCCES</p>
        <h1 className="mt-1 text-2xl font-black text-[#13263d]">Iniciar sesión</h1>
        <p className="mt-2 text-sm text-slate-600">Los coordinadores y servidores entran con celular y contraseña. ADMIN entra con correo y contraseña.</p>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2" role="tablist" aria-label="Método de acceso">
        <button type="button" role="tab" aria-selected={method === "phone"} className={method === "phone" ? "bg-[#13263d] text-white" : "border bg-white"} onClick={() => { setMethod("phone"); setError(""); }}>
          <Smartphone /> Celular
        </button>
        <button type="button" role="tab" aria-selected={method === "email"} className={method === "email" ? "bg-[#13263d] text-white" : "border bg-white"} onClick={() => { setMethod("email"); setError(""); }}>
          Correo ADMIN
        </button>
      </div>
      {method === "phone" ? <form onSubmit={submitPhone}>
        <label className="mb-4 block"><span>Celular mexicano</span><input className="mt-1 w-full" type="tel" inputMode="numeric" placeholder="+52 664 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required /></label>
        <label className="mb-5 block"><span>Contraseña</span><div className="relative mt-1"><input className="w-full pr-12" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /><button type="button" className="absolute inset-y-0 right-2 my-auto grid h-10 w-10 place-items-center" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div></label>
        <button disabled={busy} className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="submit"><LogIn /> {busy ? "Validando..." : "Entrar"}</button>
      </form> : <form onSubmit={submitEmail}>
        <label className="mb-4 block"><span>Email del ADMIN</span><input className="mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label className="mb-5 block"><span>Contraseña</span><div className="relative mt-1"><input className="w-full pr-12" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /><button type="button" className="absolute inset-y-0 right-2 my-auto grid h-10 w-10 place-items-center" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div></label>
        <button disabled={busy} className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="submit"><LogIn /> {busy ? "Validando..." : "Entrar como ADMIN"}</button>
      </form>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <p className="mt-5 text-center text-sm text-slate-600">¿Tienes un código? <Link className="font-bold underline" href="/aceptar-invitacion">Aceptar invitación</Link></p>
    </section>
  </main>;
}
