"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const PHONE_AUTH_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PHONE_AUTH === "true";

function normalizeMexicanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  return national.length === 10 ? `+52${national}` : null;
}

export function PhoneLinkForm() {
  const supabase = createClient();
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!supabase) return setMessage("Supabase no está configurado.");
    const normalized = normalizeMexicanPhone(phone);
    if (!normalized) return setMessage("Captura un número mexicano de 10 dígitos.");
    if (Date.now() - sentAt < 30_000) return setMessage("Espera antes de reenviar el código.");
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.updateUser({ phone: normalized });
    setBusy(false);
    if (error) return setMessage("No se pudo iniciar la vinculación. El número puede estar vinculado a otra cuenta.");
    setPhone(normalized); setSent(true); setSentAt(Date.now());
    setMessage("Código enviado. Verifica el número para completar la vinculación.");
  }

  async function verify() {
    if (!supabase || !/^\d{6}$/.test(token)) return setMessage("Captura el código de 6 dígitos.");
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: "phone_change" });
    setBusy(false);
    setMessage(error ? "No se pudo verificar el código. Solicita uno nuevo." : "Celular vinculado y verificado.");
    if (!error) { setSent(false); setToken(""); }
  }

  if (!PHONE_AUTH_ENABLED) return null;
  return <section className="mt-5 rounded-lg border bg-slate-50 p-4"><h3 className="font-bold">Vincular celular para iniciar sesión</h3><p className="mt-1 text-sm text-slate-600">El número se verifica mediante SMS y se asocia a esta cuenta Auth. No se fusionan cuentas.</p><label className="mt-3 block text-sm font-bold">Celular<input className="mt-1 w-full" type="tel" inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>{sent && <label className="mt-3 block text-sm font-bold">Código<input className="mt-1 w-full" type="text" inputMode="numeric" maxLength={6} value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" /></label>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void (sent ? verify() : send())} className="bg-[#13263d] text-white">{busy ? "Procesando..." : sent ? "Verificar celular" : "Enviar código"}</button>{sent && <button type="button" disabled={busy} onClick={() => void send()} className="border bg-white">Reenviar</button>}</div>{message && <p role="status" className="mt-3 text-sm">{message}</p>}</section>;
}
