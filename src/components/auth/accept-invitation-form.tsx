"use client";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AcceptInvitationForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/accept-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, password, password_confirmation: confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo aceptar la invitación.");
      setAccepted(true);
      window.setTimeout(() => router.replace("/login"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aceptar la invitación.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[#eef3f6] px-4 py-8">
    <section className="card-panel w-full max-w-md p-6 sm:p-8">
      <p className="text-sm font-extrabold uppercase tracking-wide text-[#9a7438]">RCCES</p>
      <h1 className="mt-1 text-2xl font-black text-[#13263d]">Aceptar invitación</h1>
      <p className="mt-2 mb-6 text-sm text-slate-600">Captura el celular al que te enviaron el código y crea tu contraseña para entrar a la aplicación.</p>
      {accepted ? <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        Invitación aceptada. Ya puedes iniciar sesión con tu celular y contraseña.
        <Link className="mt-3 block font-bold underline" href="/login">Ir a iniciar sesión</Link>
      </div> : <form className="space-y-4" onSubmit={submit}>
        <label className="block"><span>Celular mexicano</span><input className="mt-1 w-full" type="tel" inputMode="tel" autoComplete="tel" placeholder="+52 664 123 4567" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="block"><span>Código de invitación</span><input className="mt-1 w-full font-mono uppercase tracking-wide" autoCapitalize="characters" autoComplete="one-time-code" required minLength={12} maxLength={50} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
        <label className="block"><span>Contraseña</span><div className="relative mt-1"><input className="w-full pr-12" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="absolute inset-y-0 right-2 my-auto grid h-10 w-10 place-items-center" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div></label>
        <label className="block"><span>Confirmar contraseña</span><div className="relative mt-1"><input className="w-full pr-12" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /><button type="button" className="absolute inset-y-0 right-2 my-auto grid h-10 w-10 place-items-center" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div></label>
        {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full bg-[#13263d] text-white hover:bg-[#1d3a5b]" type="submit">{busy ? "Validando invitación..." : "Aceptar invitación"}</button>
      </form>}
      <Link className="mt-5 block text-center text-sm underline" href="/login">Volver al inicio de sesión</Link>
    </section>
  </main>;
}
