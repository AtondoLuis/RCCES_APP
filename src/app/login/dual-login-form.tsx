"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Method = "email" | "phone";
const PHONE_AUTH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PHONE_AUTH === "true";
function normalizeMexicanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  return national.length === 10 ? `+52${national}` : null;
}
function safeAuthError() { return "No se pudo completar el acceso. Verifica tus datos o solicita un nuevo código."; }

export default function DualLoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [lastOtpSentAt, setLastOtpSentAt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function redirectByProfile() {
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { data: auth } = await supabase.auth.getUser();
    const { data: profile, error: profileError } = await supabase.from("profiles").select("active,parish_id,role").eq("id", auth.user?.id ?? "").maybeSingle();
    if (profileError || !profile?.active || !profile.parish_id) {
      await supabase.auth.signOut();
      throw new Error(profileError ? "No se pudo verificar tu perfil." : "Tu acceso está desactivado o no tienes un perfil autorizado.");
    }
    router.replace(profile.role === "SERVIDOR" ? "/portal" : "/comisiones");
    router.refresh();
  }
  async function sendOtp() {
    if (!supabase) return setError("Supabase no está configurado.");
    const normalized = normalizeMexicanPhone(phone);
    if (!normalized) return setError("Captura un número celular mexicano de 10 dígitos.");
    if (Date.now() - lastOtpSentAt < 30_000) return setError("Espera unos segundos antes de solicitar otro código.");
    setBusy(true); setError("");
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: false } });
    setBusy(false);
    if (otpError) return setError(safeAuthError());
    setPhone(normalized); setOtpSent(true); setLastOtpSentAt(Date.now());
  }
  async function verifyOtp() {
    if (!supabase) return setError("Supabase no está configurado.");
    const normalized = normalizeMexicanPhone(phone);
    if (!normalized || !/^\d{6}$/.test(otp)) return setError("Captura el código de 6 dígitos recibido por SMS.");
    setBusy(true); setError("");
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: normalized, token: otp, type: "sms" });
    if (verifyError) { setBusy(false); return setError(safeAuthError()); }
    try { await redirectByProfile(); } catch (profileError) { setError(profileError instanceof Error ? profileError.message : safeAuthError()); } finally { setBusy(false); }
  }
  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return setError("Supabase no está configurado.");
    setBusy(true); setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) { setBusy(false); return setError(safeAuthError()); }
    try { await redirectByProfile(); } catch (profileError) { setError(profileError instanceof Error ? profileError.message : safeAuthError()); } finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-[#eef3f6] px-4 py-8"><section className="card-panel w-full max-w-md p-6 sm:p-8">
    <div className="mb-6"><p className="text-sm font-extrabold uppercase tracking-wide text-[#9a7438]">RCCES</p><h1 className="mt-1 text-2xl font-black text-[#13263d]">Iniciar sesión</h1><p className="mt-2 text-sm text-slate-600">Accede con correo o con el celular verificado de tu cuenta.</p></div>
    <div className={PHONE_AUTH_ENABLED ? "mb-5 grid grid-cols-2 gap-2" : "mb-5"} role="tablist" aria-label="Método de acceso"><button type="button" className={method === "email" ? "bg-[#13263d] text-white" : "border bg-white"} onClick={() => { setMethod("email"); setError(""); }}>Entrar con correo</button>{PHONE_AUTH_ENABLED && <button type="button" className={method === "phone" ? "bg-[#13263d] text-white" : "border bg-white"} onClick={() => { setMethod("phone"); setError(""); }}>Entrar con celular</button>}</div>
    {method === "email" ? <form onSubmit={submitEmail}><label className="mb-4 block"><span>Email</span><input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label><label className="mb-5 block"><span>Contraseña</span><input className="mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label><button disabled={busy} className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="submit"><LogIn /> {busy ? "Validando..." : "Entrar"}</button></form> : <div><label className="mb-4 block"><span>Celular mexicano</span><input className="mt-1" type="tel" inputMode="numeric" placeholder="664 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required /></label>{!otpSent ? <button disabled={busy} className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="button" onClick={() => void sendOtp()}><Smartphone /> {busy ? "Enviando..." : "Enviar código SMS"}</button> : <><label className="mb-4 block"><span>Código de verificación</span><input className="mt-1 tracking-[0.35em]" type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" required /></label><button disabled={busy} className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="button" onClick={() => void verifyOtp()}><LogIn /> {busy ? "Verificando..." : "Verificar y entrar"}</button><button disabled={busy} className="mt-3 w-full border bg-white" type="button" onClick={() => void sendOtp()}>Reenviar código</button></>}</div>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}{PHONE_AUTH_ENABLED && method === "phone" && <p className="mt-4 text-xs text-slate-500">Usaremos el formato +52 y no revelaremos si el número está registrado. El proveedor SMS aplica límites de intentos y costo por mensaje.</p>}
  </section></main>;
}
