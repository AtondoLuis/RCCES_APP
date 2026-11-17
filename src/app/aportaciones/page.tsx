"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { createClient } from "@/lib/supabase/client";
import { SERVER_CLASSES } from "@/lib/server-classes";

type Person = { id: string; first_name: string; last_name: string; display_name: string | null; active: boolean; class_id: string | null };
type Event = { id: string; name: string; description: string | null; status: "active" | "finished" | "cancelled"; suggested_amount: number; deadline: string | null };
type Participant = { id: string; server_id: string; required_amount: number };
type Payment = { id: string; server_id: string; amount: number; paid_at: string; status: "active" | "voided"; void_reason: string | null };
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
const tijuanaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function personName(person?: Person) {
  return person?.display_name || `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim() || "Servidor";
}

export default function ContributionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("100");
  const [deadline, setDeadline] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [editingPayment, setEditingPayment] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const [peopleResult, eventResult] = await Promise.all([
      supabase.from("people").select("id,first_name,last_name,display_name,active,class_id").order("first_name"),
      supabase.from("fundraising_events").select("id,name,description,status,suggested_amount,deadline").order("created_at", { ascending: false }),
    ]);
    const firstError = peopleResult.error ?? eventResult.error;
    if (firstError) setError(firstError.message);
    else { setPeople((peopleResult.data ?? []) as Person[]); setEvents((eventResult.data ?? []) as Event[]); }
  }, [supabase]);
  const loadEvent = useCallback(async (eventId: string) => {
    if (!supabase || !eventId) return;
    const [participantsResult, paymentsResult] = await Promise.all([
      supabase.from("fundraising_participants").select("id,server_id,required_amount").eq("event_id", eventId),
      supabase.from("fundraising_payments").select("id,server_id,amount,paid_at,status,void_reason").eq("event_id", eventId).order("paid_at", { ascending: false }),
    ]);
    const firstError = participantsResult.error ?? paymentsResult.error;
    if (firstError) setError(firstError.message);
    else { setParticipants((participantsResult.data ?? []) as Participant[]); setPayments((paymentsResult.data ?? []) as Payment[]); }
  }, [supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!selectedEvent) return;
    const timer = window.setTimeout(() => { void loadEvent(selectedEvent); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEvent, selectedEvent]);

  const event = events.find((item) => item.id === selectedEvent);
  const visibleParticipants = participants.filter((participant) => {
    const person = people.find((item) => item.id === participant.server_id);
    return !classFilter || person?.class_id === classFilter;
  });
  const paymentSum = (serverId: string) => payments.filter((payment) => payment.server_id === serverId && payment.status === "active").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const requiredTotal = participants.reduce((sum, item) => sum + Number(item.required_amount), 0);
  const paidTotal = payments.filter((payment) => payment.status === "active").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const outstandingTotal = participants.reduce((sum, item) => sum + Math.max(0, Number(item.required_amount) - paymentSum(item.server_id)), 0);
  const completeCount = participants.filter((item) => Number(item.required_amount) > 0 && paymentSum(item.server_id) >= Number(item.required_amount)).length;

  async function createEvent() {
    if (!supabase || !name.trim()) { setError("Ingresa el nombre del evento."); return; }
    const required = Number(amount);
    if (!Number.isFinite(required) || required < 0 || required > 9999999999.99) { setError("El monto debe estar entre $0.00 y $9,999,999,999.99."); return; }
    const result = await supabase.rpc("create_fundraising_event", {
      p_name: name.trim(), p_description: null, p_deadline: deadline || null, p_suggested_amount: required, p_server_ids: selected,
    });
    if (result.error) setError(result.error.message);
    else {
      setSaved("Evento creado."); setError(""); setName(""); setSelected([]); setDeadline("");
      await load(); setSelectedEvent(result.data as string);
    }
  }
  async function registerPayment(serverId: string) {
    if (!supabase || !selectedEvent) return;
    const participant = participants.find((item) => item.server_id === serverId);
    const enteredAmount = payAmounts[serverId]?.trim();
    const value = enteredAmount ? Number(enteredAmount) : Math.max(0, Number(participant?.required_amount ?? event?.suggested_amount ?? 0) - paymentSum(serverId));
    if (!Number.isFinite(value) || value <= 0 || value > 9999999999.99) { setError("El pago debe ser mayor a cero y no exceder el límite permitido."); return; }
    const result = await supabase.rpc("register_fundraising_payment", { p_event_id: selectedEvent, p_server_id: serverId, p_amount: value, p_paid_at: tijuanaDate() });
    if (result.error) setError(result.error.message);
    else { setError(""); setSaved("Pago registrado y contabilizado."); setPayAmounts((current) => ({ ...current, [serverId]: "" })); await loadEvent(selectedEvent); }
  }
  async function savePayment(payment: Payment) {
    if (!supabase) return;
    const value = Number(editAmount);
    if (!Number.isFinite(value) || value <= 0 || value > 9999999999.99 || !editDate) { setError("Indica fecha e importe mayor a cero."); return; }
    const result = await supabase.rpc("update_fundraising_payment", { p_payment_id: payment.id, p_amount: value, p_paid_at: editDate });
    if (result.error) setError(result.error.message);
    else { setError(""); setSaved("Pago y movimiento de Tesorería actualizados con auditoría."); setEditingPayment(null); await loadEvent(selectedEvent); }
  }
  async function voidPayment(payment: Payment) {
    if (!supabase) return;
    const reason = window.prompt("Motivo para anular el pago:");
    if (reason === null) return;
    if (!reason.trim()) { setError("Escribe un motivo de anulación."); return; }
    if (!window.confirm("El pago y su movimiento de Tesorería quedarán anulados conservando el historial. ¿Continuar?")) return;
    const result = await supabase.rpc("void_fundraising_payment", { p_payment_id: payment.id, p_reason: reason.trim() });
    if (result.error) setError(result.error.message);
    else { setError(""); setSaved("Pago anulado con trazabilidad."); await loadEvent(selectedEvent); }
  }
  async function changeEventStatus(status: Event["status"]) {
    if (!supabase || !event) return;
    if (!window.confirm(status === "finished" ? "¿Cerrar el evento? Su historial de pagos se conservará." : `¿Cambiar el evento a ${status}?`)) return;
    const result = await supabase.rpc("set_fundraising_event_status", { p_event_id: event.id, p_status: status });
    if (result.error) setError(result.error.message);
    else { setSaved("Estado del evento actualizado."); await load(); }
  }
  function exportEventCsv() {
    if (!event) return;
    const rows = [["Servidor", "Monto requerido", "Monto pagado", "Pendiente", "Estado", "Fecha pago", "Importe pago", "Estado pago"]];
    for (const participant of participants) {
      const personPayments = payments.filter((payment) => payment.server_id === participant.server_id);
      const total = paymentSum(participant.server_id);
      const state = total === 0 ? "Pendiente" : total < Number(participant.required_amount) ? "Parcial" : "Aportó";
      if (!personPayments.length) rows.push([personName(people.find((person) => person.id === participant.server_id)), String(participant.required_amount), money(total), money(Math.max(0, Number(participant.required_amount) - total)), state, "", "", ""]);
      else for (const payment of personPayments) rows.push([personName(people.find((person) => person.id === participant.server_id)), String(participant.required_amount), money(total), money(Math.max(0, Number(participant.required_amount) - total)), state, payment.paid_at, money(Number(payment.amount)), payment.status]);
    }
    downloadCsv(`${event.name.toLocaleLowerCase("es-MX").replace(/[^a-z0-9]+/g, "-")}-aportaciones.csv`, rows);
  }

  return <ModuleShell>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm font-bold uppercase tracking-wide text-[#b18b4a]">Tesorería</p><h1 className="text-2xl font-bold">Aportaciones y cobros</h1></div>
      {event && <div className="no-print flex gap-2"><button className="border bg-white" onClick={exportEventCsv}>Exportar CSV</button><button className="border bg-white" onClick={() => window.print()}>Exportar PDF</button></div>}
    </div>
    {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {saved && <div role="status" className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{saved}</div>}
    <section className="no-print mb-5 card-panel p-4">
      <h2 className="mb-3 font-bold">Nuevo evento</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <label><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)}/></label>
        <label><span>Aportación por servidor</span><input type="number" min="0" max="9999999999.99" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}/></label>
        <label><span>Fecha límite (opcional)</span><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}/></label>
        <label><span>Filtrar por clase</span><select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}><option value="">Todas</option>{SERVER_CLASSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="border bg-white" onClick={() => setSelected(people.filter((person) => person.active && (!classFilter || person.class_id === classFilter)).map((person) => person.id))}>Seleccionar activos filtrados</button>
        <button className="border bg-white" onClick={() => setSelected([])}>Limpiar selección</button>
        <button className="primary" onClick={() => void createEvent()}>Crear evento</button>
      </div>
      <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {people.filter((person) => person.active && (!classFilter || person.class_id === classFilter)).map((person) => <label key={person.id} className="flex items-center gap-2 rounded border p-2">
          <input type="checkbox" checked={selected.includes(person.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...new Set([...current, person.id])] : current.filter((id) => id !== person.id))}/>
          <span>{personName(person)}</span>
        </label>)}
      </div>
    </section>
    <section className="no-print mb-5 card-panel p-4">
      <label className="block"><span className="mb-1 block text-sm font-bold">Evento</span><select value={selectedEvent} onChange={(e) => setSelectedEvent(e.target.value)}><option value="">Selecciona un evento</option>{events.map((item) => <option key={item.id} value={item.id}>{item.name} · {eventStatus(item.status)}</option>)}</select></label>
    </section>
    {event && <>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="card-panel p-4"><span className="text-xs uppercase text-slate-500">Meta</span><p className="text-xl font-black">{money(requiredTotal)}</p></div>
        <div className="card-panel p-4"><span className="text-xs uppercase text-slate-500">Recaudado</span><p className="text-xl font-black text-emerald-700">{money(paidTotal)}</p></div>
        <div className="card-panel p-4"><span className="text-xs uppercase text-slate-500">Pendiente</span><p className="text-xl font-black">{money(outstandingTotal)}</p></div>
        <div className="card-panel p-4"><span className="text-xs uppercase text-slate-500">Avance · completaron</span><p className="text-xl font-black">{requiredTotal ? `${Math.min(100, paidTotal / requiredTotal * 100).toFixed(1)}%` : "—"} · {completeCount}/{participants.length}</p></div>
      </div>
      <section className="card-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{event.name} · {eventStatus(event.status)}</h2>
          <div className="no-print flex flex-wrap gap-2">{event.status === "active" ? <button className="border bg-white" onClick={() => void changeEventStatus("finished")}>Cerrar evento</button> : event.status === "finished" && <button className="border bg-white" onClick={() => void changeEventStatus("active")}>Reabrir evento</button>}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead><tr className="text-left text-slate-500"><th>Servidor</th><th>Meta</th><th>Pagado</th><th>Pendiente / estado</th><th className="no-print">Registrar pago</th></tr></thead>
            <tbody>{visibleParticipants.map((participant) => {
              const person = people.find((item) => item.id === participant.server_id);
              const total = paymentSum(participant.server_id);
              const due = Math.max(0, Number(participant.required_amount) - total);
              const state = total === 0 ? "Pendiente" : due > 0 ? "Parcial" : "Aportó";
              return <tr key={participant.id} className="border-t align-top">
                <td className="py-3 font-semibold">{personName(person)}</td><td>{money(Number(participant.required_amount))}</td><td>{money(total)}</td>
                <td>{money(due)} · {state}{total > Number(participant.required_amount) && <span className="block text-xs font-bold text-amber-700">Excedente: {money(total - Number(participant.required_amount))}</span>}
                  <div className="mt-2 space-y-1">{payments.filter((payment) => payment.server_id === participant.server_id).map((payment) => <div key={payment.id} className="rounded border p-2 text-xs">
                    {editingPayment === payment.id ? <div className="no-print flex flex-wrap gap-1">
                      <input aria-label="Fecha del pago" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}/>
                      <input aria-label="Importe del pago" type="number" min="0.01" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}/>
                      <button className="border bg-white" onClick={() => void savePayment(payment)}>Guardar</button>
                      <button className="border bg-white" onClick={() => setEditingPayment(null)}>Cancelar</button>
                    </div> : <span className={payment.status === "voided" ? "text-slate-400 line-through" : ""}>{payment.paid_at} · {money(Number(payment.amount))} · {payment.status === "active" ? "Activo" : `Anulado: ${payment.void_reason ?? ""}`}</span>}
                    {payment.status === "active" && editingPayment !== payment.id && <span className="no-print ml-2 inline-flex gap-1">
                      <button className="border bg-white" onClick={() => { setEditingPayment(payment.id); setEditAmount(String(payment.amount)); setEditDate(payment.paid_at); }}>Editar</button>
                      <button className="border bg-white text-red-700" onClick={() => void voidPayment(payment)}>Anular</button>
                    </span>}
                  </div>)}</div>
                </td>
                <td className="no-print"><div className="flex min-w-48 gap-2">
                  <input aria-label={`Importe para ${personName(person)}`} type="number" min="0.01" step="0.01" value={payAmounts[participant.server_id] ?? ""} placeholder={money(due || Number(participant.required_amount))} onChange={(e) => setPayAmounts((current) => ({ ...current, [participant.server_id]: e.target.value }))}/>
                  <button className="primary" disabled={event.status !== "active"} onClick={() => void registerPayment(participant.server_id)}>Registrar</button>
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {!participants.length && <p className="mt-3 text-sm text-slate-500">Este evento no tiene participantes.</p>}
      </section>
    </>}
  </ModuleShell>;
}

function eventStatus(status: Event["status"]) {
  return status === "active" ? "Activo" : status === "finished" ? "Finalizado" : "Cancelado";
}
