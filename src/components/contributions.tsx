"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { createClient } from "@/lib/supabase/client";
import { SERVER_CLASSES } from "@/lib/server-classes";
import { readAll } from "@/lib/read-all";

type Person = { id: string; first_name: string; last_name: string; display_name: string | null; active: boolean; class_id: string | null };
type Event = { id: string; name: string; description: string | null; status: "active" | "finished" | "cancelled"; suggested_amount: number; deadline: string | null };
type Participant = { id: string; server_id: string; required_amount: number; status: "active" | "cancelled" };
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

export default function Contributions({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [personQuery, setPersonQuery] = useState("");
  const [paymentQuery, setPaymentQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "pending" | "partial" | "paid">("all");
  const [editingEvent, setEditingEvent] = useState(false);
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const pendingRequests = useRef<Map<string, string>>(new Map());
  const inFlight = useRef(false);
  const eventLoadSequence = useRef(0);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("100");
  const [deadline, setDeadline] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [editingPayment, setEditingPayment] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    const [managePermission, exportPermission] = await Promise.all([
      supabase.rpc("has_app_permission", { p_permission: "treasury.manage" }),
      supabase.rpc("has_app_permission", { p_permission: "treasury.export" }),
    ]);
    if (managePermission.error || exportPermission.error) {
      setError(managePermission.error?.message ?? exportPermission.error?.message ?? "No se pudieron verificar los permisos.");
      return;
    }
    setCanManage(managePermission.data === true);
    setCanExport(exportPermission.data === true);
    const [peopleResult, eventResult] = await Promise.all([
      readAll<Person>(async (from, to) => await supabase.from("people").select("id,first_name,last_name,display_name,active,class_id").order("first_name").order("id").range(from, to)),
      readAll<Event>(async (from, to) => await supabase.from("fundraising_events").select("id,name,description,status,suggested_amount,deadline").order("created_at", { ascending: false }).order("id").range(from, to)),
    ]);
    const firstError = peopleResult.error ?? eventResult.error;
    if (firstError) setError(firstError.message);
    else { setPeople((peopleResult.data ?? []) as Person[]); setEvents((eventResult.data ?? []) as Event[]); }
  }, [supabase]);
  const loadEvent = useCallback(async (eventId: string) => {
    if (!supabase || !eventId) return;
    const sequence = ++eventLoadSequence.current;
    const [participantsResult, paymentsResult] = await Promise.all([
      readAll<Participant>(async (from, to) => await supabase.from("fundraising_participants").select("id,server_id,required_amount,status").eq("event_id", eventId).order("id").range(from, to)),
      readAll<Payment>(async (from, to) => await supabase.from("fundraising_payments").select("id,server_id,amount,paid_at,status,void_reason").eq("event_id", eventId).order("paid_at", { ascending: false }).order("id").range(from, to)),
    ]);
    if (sequence !== eventLoadSequence.current) return;
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
  const paymentSum = (serverId: string) => payments.filter((payment) => payment.server_id === serverId && payment.status === "active").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const activeParticipants = participants.filter((participant) => participant.status === "active");
  const paymentState = (participant: Participant) => {
    const paid = paymentSum(participant.server_id);
    const required = Number(participant.required_amount);
    return paid === 0 ? "pending" : paid < required ? "partial" : paid > required ? "excess" : "paid";
  };
  const visibleParticipants = activeParticipants.filter((participant) => {
    const person = people.find((item) => item.id === participant.server_id);
    const state = paymentState(participant);
    return (!classFilter || person?.class_id === classFilter)
      && (!paymentQuery || personName(person).toLocaleLowerCase("es-MX").includes(paymentQuery.toLocaleLowerCase("es-MX")))
      && (paymentFilter === "all" || (paymentFilter === "paid" ? state === "paid" || state === "excess" : state === paymentFilter));
  });
  const requiredTotal = activeParticipants.reduce((sum, item) => sum + Number(item.required_amount), 0);
  const paidTotal = payments.filter((payment) => payment.status === "active").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const outstandingTotal = activeParticipants.reduce((sum, item) => sum + Math.max(0, Number(item.required_amount) - paymentSum(item.server_id)), 0);
  const completeCount = activeParticipants.filter((item) => Number(item.required_amount) > 0 && paymentSum(item.server_id) >= Number(item.required_amount)).length;

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
      await load(); eventLoadSequence.current += 1; setParticipants([]); setPayments([]); setSelectedEvent(result.data as string); onChanged?.();
    }
  }
  async function registerPayment(serverId: string, partial = false) {
    if (!supabase || !selectedEvent || inFlight.current) return;
    const participant = participants.find((item) => item.server_id === serverId);
    const enteredAmount = payAmounts[serverId]?.trim();
    const value = partial ? Number(enteredAmount) : null;
    if (!participant || (partial && (!Number.isFinite(value) || (value ?? 0) <= 0 || (value ?? 0) > 9999999999.99))) {
      setError("Indica un importe parcial válido."); return;
    }
    const key = `${selectedEvent}:${serverId}:${partial ? enteredAmount : "complete"}`;
    const requestId = pendingRequests.current.get(key) ?? crypto.randomUUID();
    pendingRequests.current.set(key, requestId);
    inFlight.current = true;
    setBusyServer(serverId); setError(""); setSaved("");
    try {
      const result = await supabase.rpc("register_fundraising_payment_once", {
        p_event_id: selectedEvent, p_server_id: serverId, p_request_id: requestId,
        p_amount: value, p_paid_at: tijuanaDate(),
      });
      if (result.error) setError(result.error.message);
      else {
        pendingRequests.current.delete(key);
        setSaved("Pago registrado y contabilizado.");
        setPayAmounts((current) => ({ ...current, [serverId]: "" }));
        await loadEvent(selectedEvent); onChanged?.();
      }
    } catch {
      setError("No se pudo confirmar el pago. Reintenta para verificar la operación sin duplicarla.");
    } finally {
      inFlight.current = false;
      setBusyServer(null);
    }
  }
  async function addParticipants() {
    if (!supabase || !selectedEvent || !selected.length || busyServer) return;
    setBusyServer("participants"); setError("");
    const result = await supabase.rpc("add_fundraising_participants", { p_event_id: selectedEvent, p_server_ids: selected });
    if (result.error) setError(result.error.message);
    else { setSaved("Servidores agregados."); setSelected([]); setShowPicker(false); await loadEvent(selectedEvent); onChanged?.(); }
    setBusyServer(null);
  }
  async function removeParticipant(participant: Participant) {
    if (!supabase || !selectedEvent || busyServer) return;
    const hasHistory = payments.some((payment) => payment.server_id === participant.server_id);
    if (!window.confirm(hasHistory
      ? "Este servidor tiene historial de pagos. Se cancelará su participación sin borrar pagos ni movimientos. ¿Continuar?"
      : "¿Retirar este servidor del evento?")) return;
    setBusyServer(participant.server_id); setError("");
    const result = await supabase.rpc("remove_fundraising_participant", { p_event_id: selectedEvent, p_server_id: participant.server_id });
    if (result.error) setError(result.error.message);
    else { setSaved(result.data === "cancelled" ? "Participación cancelada; historial conservado." : "Servidor retirado."); await loadEvent(selectedEvent); onChanged?.(); }
    setBusyServer(null);
  }
  async function saveEvent() {
    if (!supabase || !event || busyServer) return;
    const value = Number(amount);
    if (!name.trim() || !Number.isFinite(value) || value < 0) { setError("Indica nombre y aportación válidos."); return; }
    setBusyServer("event"); setError("");
    const result = await supabase.rpc("update_fundraising_event", {
      p_event_id: event.id, p_name: name.trim(), p_description: event.description,
      p_deadline: deadline || null, p_suggested_amount: value,
    });
    if (result.error) setError(result.error.message);
    else { setSaved("Evento actualizado."); setEditingEvent(false); await load(); await loadEvent(event.id); onChanged?.(); }
    setBusyServer(null);
  }
  async function savePayment(payment: Payment) {
    if (!supabase) return;
    const value = Number(editAmount);
    if (!Number.isFinite(value) || value <= 0 || value > 9999999999.99 || !editDate) { setError("Indica fecha e importe mayor a cero."); return; }
    const result = await supabase.rpc("update_fundraising_payment", { p_payment_id: payment.id, p_amount: value, p_paid_at: editDate });
    if (result.error) setError(result.error.message);
    else { setError(""); setSaved("Pago y movimiento de Tesorería actualizados con auditoría."); setEditingPayment(null); await loadEvent(selectedEvent); onChanged?.(); }
  }
  async function voidPayment(payment: Payment) {
    if (!supabase) return;
    const reason = window.prompt("Motivo para anular el pago:");
    if (reason === null) return;
    if (!reason.trim()) { setError("Escribe un motivo de anulación."); return; }
    if (!window.confirm("El pago y su movimiento de Tesorería quedarán anulados conservando el historial. ¿Continuar?")) return;
    const result = await supabase.rpc("void_fundraising_payment", { p_payment_id: payment.id, p_reason: reason.trim() });
    if (result.error) setError(result.error.message);
    else { setError(""); setSaved("Pago anulado con trazabilidad."); await loadEvent(selectedEvent); onChanged?.(); }
  }
  async function changeEventStatus(status: Event["status"]) {
    if (!supabase || !event) return;
    if (!window.confirm(status === "finished" ? "¿Cerrar el evento? Su historial de pagos se conservará." : `¿Cambiar el evento a ${status}?`)) return;
    const result = await supabase.rpc("set_fundraising_event_status", { p_event_id: event.id, p_status: status });
    if (result.error) setError(result.error.message);
    else { setSaved("Estado del evento actualizado."); await load(); onChanged?.(); }
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

  const content = <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-xl font-bold">Eventos y aportaciones</h2></div>
      {event && canExport && <div className="no-print flex gap-2"><button className="border bg-white" onClick={exportEventCsv}>Exportar CSV</button><button className="border bg-white" onClick={() => window.print()}>Exportar PDF</button></div>}
    </div>
    {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {saved && <div role="status" className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{saved}</div>}
    {canManage && <details className="no-print mb-5 card-panel p-4">
      <summary className="cursor-pointer font-bold">+ Crear evento</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)}/></label>
        <label><span>Aportación por servidor</span><input type="number" min="0" max="9999999999.99" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}/></label>
        <label><span>Fecha límite (opcional)</span><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}/></label>
      </div>
      <p className="mt-2 text-sm text-slate-600">Puedes crear el evento sin servidores y agregarlos después.</p>
      <button className="primary mt-3 min-h-11" disabled={!!busyServer} onClick={() => void createEvent()}>Crear evento</button>
    </details>}
    <section className="no-print mb-5 card-panel p-4">
      <label className="block"><span className="mb-1 block text-sm font-bold">Evento</span><select value={selectedEvent} onChange={(e) => { eventLoadSequence.current += 1; setParticipants([]); setPayments([]); setSelectedEvent(e.target.value); }}><option value="">Selecciona un evento</option>{events.map((item) => <option key={item.id} value={item.id}>{item.name} · {eventStatus(item.status)}</option>)}</select></label>
    </section>
    {event && <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="card-panel p-3"><span className="text-xs text-slate-500">Participantes</span><p className="font-black">{activeParticipants.length}</p></div>
        <div className="card-panel p-3"><span className="text-xs text-slate-500">Aportación</span><p className="font-black">{money(Number(event.suggested_amount))}</p></div>
        <div className="card-panel p-3"><span className="text-xs text-slate-500">Meta</span><p className="font-black">{money(requiredTotal)}</p></div>
        <div className="card-panel p-3"><span className="text-xs text-slate-500">Recaudado</span><p className="font-black text-emerald-700">{money(paidTotal)}</p></div>
        <div className="card-panel p-3"><span className="text-xs text-slate-500">Pendiente</span><p className="font-black">{money(outstandingTotal)}</p></div>
        <div className="card-panel p-3"><span className="text-xs text-slate-500">Pagaron</span><p className="font-black">{completeCount}/{activeParticipants.length}</p></div>
        <div className="card-panel col-span-2 p-3"><span className="text-xs text-slate-500">Avance · {requiredTotal ? `${Math.min(100, paidTotal / requiredTotal * 100).toFixed(1)}%` : "0%"}</span><progress className="mt-2 h-3 w-full" value={Math.min(requiredTotal, paidTotal)} max={requiredTotal || 1} /></div>
      </div>
      <section className="card-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{event.name} · {eventStatus(event.status)}</h2>
          {canManage && <div className="no-print flex flex-wrap gap-2">{event.status === "active" && <><button className="border bg-white" onClick={() => setShowPicker((value) => !value)}>+ Agregar servidores</button><button className="border bg-white" onClick={() => { setName(event.name); setAmount(String(event.suggested_amount)); setDeadline(event.deadline ?? ""); setEditingEvent(true); }}>Editar evento</button><button className="border bg-white" onClick={() => void changeEventStatus("finished")}>Cerrar evento</button></>}{event.status === "finished" && <button className="border bg-white" onClick={() => void changeEventStatus("active")}>Reabrir evento</button>}</div>}
        </div>
        {editingEvent && <div className="no-print mb-4 grid gap-2 rounded border p-3 sm:grid-cols-3"><label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} /></label><label>Aportación<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label>Fecha límite<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label><button className="primary min-h-11" disabled={!!busyServer} onClick={() => void saveEvent()}>Guardar cambios</button><button className="border bg-white" onClick={() => setEditingEvent(false)}>Cancelar</button></div>}
        {showPicker && event.status === "active" && <div className="no-print mb-4 rounded border p-3">
          <div className="grid gap-2 sm:grid-cols-2"><input aria-label="Buscar servidores" placeholder="Buscar servidor" value={personQuery} onChange={(e) => setPersonQuery(e.target.value)}/><select aria-label="Filtrar por clase" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}><option value="">Todas las clases</option>{SERVER_CLASSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="mt-2 flex flex-wrap gap-2"><button className="border bg-white" onClick={() => setSelected(people.filter((person) => person.active && !activeParticipants.some((item) => item.server_id === person.id) && (!classFilter || person.class_id === classFilter) && personName(person).toLocaleLowerCase("es-MX").includes(personQuery.toLocaleLowerCase("es-MX"))).map((person) => person.id))}>Seleccionar todos los visibles</button><button className="border bg-white" onClick={() => setSelected([])}>Limpiar</button><button className="primary" disabled={!selected.length || !!busyServer} onClick={() => void addParticipants()}>Guardar {selected.length} servidores</button></div>
          <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">{people.filter((person) => person.active && !activeParticipants.some((item) => item.server_id === person.id) && (!classFilter || person.class_id === classFilter) && personName(person).toLocaleLowerCase("es-MX").includes(personQuery.toLocaleLowerCase("es-MX"))).map((person) => <label key={person.id} className="flex min-h-11 items-center gap-2 rounded border p-2"><input type="checkbox" checked={selected.includes(person.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...new Set([...current, person.id])] : current.filter((id) => id !== person.id))}/>{personName(person)}</label>)}</div>
        </div>}
        <div className="no-print mb-3 grid gap-2 sm:grid-cols-2">
          <input aria-label="Buscar en lista de cobro" placeholder="Buscar servidor" value={paymentQuery} onChange={(e) => setPaymentQuery(e.target.value)} />
          <select aria-label="Filtrar pagos" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)}><option value="all">Todos ({activeParticipants.length})</option><option value="pending">Pendientes ({activeParticipants.filter((item) => paymentState(item) === "pending").length})</option><option value="partial">Parciales ({activeParticipants.filter((item) => paymentState(item) === "partial").length})</option><option value="paid">Pagaron ({completeCount})</option></select>
        </div>
        <div className="space-y-2" aria-live="polite">{visibleParticipants.map((participant) => {
              const person = people.find((item) => item.id === participant.server_id);
              const total = paymentSum(participant.server_id);
              const due = Math.max(0, Number(participant.required_amount) - total);
              const state = paymentState(participant);
              const label = state === "pending" ? "○ Pendiente" : state === "partial" ? "◐ Parcial" : state === "excess" ? "↑ Excedente" : "✓ Pagó";
              return <article key={participant.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{personName(person)}</h3><p className="text-sm text-slate-600">Aportó {money(total)} de {money(Number(participant.required_amount))} · Falta {money(due)}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${state === "paid" ? "bg-emerald-100 text-emerald-800" : state === "excess" ? "bg-amber-100 text-amber-900" : state === "partial" ? "bg-sky-100 text-sky-900" : "bg-slate-100 text-slate-700"}`}>{label}</span></div>
                {canManage && event.status === "active" && <div className="no-print mt-3 flex flex-wrap gap-2">
                  {due > 0 ? <button className="primary min-h-11" disabled={!!busyServer} onClick={() => void registerPayment(participant.server_id)}>{busyServer === participant.server_id ? "Guardando..." : `Pagó · ${money(due)}`}</button> :
                    <button className="min-h-11 border bg-white" onClick={() => { if (window.confirm("Este servidor tiene pagos registrados. ¿Deseas anular un pago específico?")) document.getElementById(`history-${participant.id}`)?.setAttribute("open", ""); }}>Revisar pagos para anular</button>}
                  <button className="min-h-11 border bg-white" disabled={!!busyServer} onClick={() => void removeParticipant(participant)}>Retirar servidor</button>
                </div>}
                {canManage && event.status === "active" && <details className="no-print mt-2"><summary className="cursor-pointer text-sm font-semibold">Registrar pago parcial</summary><div className="mt-2 flex flex-wrap gap-2"><input aria-label={`Importe parcial para ${personName(person)}`} type="number" min="0.01" step="0.01" value={payAmounts[participant.server_id] ?? ""} onChange={(e) => setPayAmounts((current) => ({ ...current, [participant.server_id]: e.target.value }))}/><button className="primary min-h-11" disabled={!!busyServer} onClick={() => void registerPayment(participant.server_id, true)}>Registrar parcial</button></div></details>}
                <details id={`history-${participant.id}`} className="mt-2"><summary className="cursor-pointer text-sm font-semibold">Historial de pagos ({payments.filter((payment) => payment.server_id === participant.server_id).length})</summary>
                  <div className="mt-2 space-y-1">{payments.filter((payment) => payment.server_id === participant.server_id).map((payment) => <div key={payment.id} className="rounded border p-2 text-xs">
                    {editingPayment === payment.id ? <div className="no-print flex flex-wrap gap-1">
                      <input aria-label="Fecha del pago" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}/>
                      <input aria-label="Importe del pago" type="number" min="0.01" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}/>
                      <button className="border bg-white" onClick={() => void savePayment(payment)}>Guardar</button>
                      <button className="border bg-white" onClick={() => setEditingPayment(null)}>Cancelar</button>
                    </div> : <span className={payment.status === "voided" ? "text-slate-400 line-through" : ""}>{payment.paid_at} · {money(Number(payment.amount))} · {payment.status === "active" ? "Activo" : `Anulado: ${payment.void_reason ?? ""}`}</span>}
                    {canManage && payment.status === "active" && editingPayment !== payment.id && <span className="no-print ml-2 inline-flex gap-1">
                      <button className="border bg-white" onClick={() => { setEditingPayment(payment.id); setEditAmount(String(payment.amount)); setEditDate(payment.paid_at); }}>Editar</button>
                      <button className="border bg-white text-red-700" onClick={() => void voidPayment(payment)}>Anular</button>
                    </span>}
                  </div>)}</div>
                </details>
              </article>;
            })}</div>
        {!activeParticipants.length && <p className="mt-3 text-sm text-slate-500">Este evento no tiene participantes activos. Usa “+ Agregar servidores” para iniciar la lista de cobro.</p>}
      </section>
    </>}
  </>;
  return embedded ? content : <ModuleShell>{content}</ModuleShell>;
}

function eventStatus(status: Event["status"]) {
  return status === "active" ? "Activo" : status === "finished" ? "Finalizado" : "Cancelado";
}
