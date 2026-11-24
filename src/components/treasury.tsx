"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { createClient } from "@/lib/supabase/client";
import Contributions from "@/components/contributions";
import { readAll } from "@/lib/read-all";

type Transaction = {
  id: string;
  transaction_date: string;
  description: string;
  transaction_type: "entrada" | "salida";
  amount: number;
  category: string;
  fundraising_event_id: string | null;
  fundraising_payment_id: string | null;
  observations: string | null;
  status: "active" | "voided";
  void_reason: string | null;
};
type Draft = Pick<Transaction, "transaction_date" | "description" | "transaction_type" | "category" | "observations"> & { amount: string; event_id: string };
const emptyDraft = (): Draft => ({
  transaction_date: "", description: "", transaction_type: "entrada",
  category: "otro", observations: "", amount: "", event_id: "",
});
const categories = ["donacion", "aportacion", "venta", "gasto", "retiro", "otro"];

function dateInTijuana() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function exportCsv(rows: Transaction[], events: Array<{ id: string; name: string }>, balances: Map<string, number>) {
  const content = [["Fecha", "Descripción", "Tipo", "Importe MXN", "Categoría", "Evento", "Estado", "Saldo acumulado MXN", "Motivo de anulación"],
    ...rows.map((row) => [row.transaction_date, row.description, row.transaction_type, Number(row.amount).toFixed(2), row.category, events.find((event) => event.id === row.fundraising_event_id)?.name ?? "", row.status, (balances.get(row.id) ?? 0).toFixed(2), row.void_reason ?? ""])]
    .map((row) => row.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "estado-cuenta.csv"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function money(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

export default function Treasury({ embedded = false }: { embedded?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; name: string }>>([]);
  const [activeEventCount, setActiveEventCount] = useState(0);
  const [pendingContributions, setPendingContributions] = useState(0);
  const [section, setSection] = useState<"events" | "movements" | "report">("events");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [eventFilter, setEventFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [canExport, setCanExport] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft((current) => ({ ...current, transaction_date: dateInTijuana() })), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [managePermission, exportPermission] = await Promise.all([
      supabase.rpc("has_app_permission", { p_permission: "treasury.manage" }),
      supabase.rpc("has_app_permission", { p_permission: "treasury.export" }),
    ]);
    if (managePermission.error || exportPermission.error) {
      setError(managePermission.error?.message ?? exportPermission.error?.message ?? "No se pudieron verificar los permisos.");
      setLoading(false);
      return;
    }
    setCanManage(managePermission.data === true);
    setCanExport(exportPermission.data === true);
    const [transactions, fundraisingEvents, participantsResult, paymentsResult] = await Promise.all([
      readAll<Transaction>(async (from, to) => await supabase.from("treasury_transactions").select("*").order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).order("id").range(from, to)),
      readAll<{ id: string; name: string; status: string }>(async (from, to) => await supabase.from("fundraising_events").select("id,name,status").order("created_at", { ascending: false }).order("id").range(from, to)),
      readAll<{ id: string; event_id: string; required_amount: number; status: string }>(async (from, to) => await supabase.from("fundraising_participants").select("id,event_id,required_amount,status").order("id").range(from, to)),
      readAll<{ participant_id: string; amount: number; status: string }>(async (from, to) => await supabase.from("fundraising_payments").select("participant_id,amount,status").order("id").range(from, to)),
    ]);
    const firstError = transactions.error ?? fundraisingEvents.error ?? participantsResult.error ?? paymentsResult.error;
    if (firstError) setError(firstError.message);
    else {
      setRows((transactions.data ?? []) as Transaction[]);
      setEvents((fundraisingEvents.data ?? []) as Array<{ id: string; name: string }>);
      setActiveEventCount((fundraisingEvents.data ?? []).filter((item) => item.status === "active").length);
      const activeIds = new Set((fundraisingEvents.data ?? []).filter((item) => item.status === "active").map((item) => item.id));
      setPendingContributions((participantsResult.data ?? []).filter((item) => item.status === "active" && activeIds.has(item.event_id)).reduce((sum, item) => {
        const paid = (paymentsResult.data ?? []).filter((payment) => payment.participant_id === item.id && payment.status === "active").reduce((total, payment) => total + Number(payment.amount), 0);
        return sum + Math.max(0, Number(item.required_amount) - paid);
      }, 0));
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const filtered = rows.filter((row) =>
    (!query || row.description.toLocaleLowerCase("es-MX").includes(query.toLocaleLowerCase("es-MX")))
    && (!typeFilter || row.transaction_type === typeFilter)
    && (!categoryFilter || row.category === categoryFilter)
    && (!eventFilter || row.fundraising_event_id === eventFilter)
    && (statusFilter === "all" || row.status === statusFilter)
    && (!fromDate || row.transaction_date >= fromDate)
    && (!toDate || row.transaction_date <= toDate));
  const activeRows = rows.filter((row) => row.status === "active");
  const entradas = activeRows.filter((row) => row.transaction_type === "entrada").reduce((sum, row) => sum + Number(row.amount), 0);
  const salidas = activeRows.filter((row) => row.transaction_type === "salida").reduce((sum, row) => sum + Number(row.amount), 0);
  const runningBalances = new Map<string, number>();
  let running = 0;
  for (const row of [...rows].reverse()) {
    if (row.status === "active") running += row.transaction_type === "entrada" ? Number(row.amount) : -Number(row.amount);
    runningBalances.set(row.id, running);
  }

  function startEdit(row: Transaction) {
    if (row.fundraising_payment_id) {
      setError("Las aportaciones se editan desde Aportaciones y cobros para conservar su vínculo contable.");
      return;
    }
    setEditingId(row.id);
    setDraft({
      transaction_date: row.transaction_date,
      description: row.description,
      transaction_type: row.transaction_type,
      amount: Number(row.amount).toFixed(2),
      category: row.category,
      observations: row.observations ?? "",
      event_id: row.fundraising_event_id ?? "",
    });
    setError("");
    setSaved("");
  }
  async function saveMovement() {
    if (!supabase) return;
    const numericAmount = Number(draft.amount);
    if (!draft.description.trim() || !draft.transaction_date || !Number.isFinite(numericAmount) || numericAmount < 0 || numericAmount > 9999999999.99) {
      setError("Ingresa descripción, fecha e importe entre $0.00 y $9,999,999,999.99.");
      return;
    }
    const values = {
      p_transaction_date: draft.transaction_date,
      p_description: draft.description.trim(),
      p_transaction_type: draft.transaction_type,
      p_amount: numericAmount,
      p_category: draft.category,
      p_event_id: draft.event_id || null,
      p_observations: draft.observations?.trim() || null,
    };
    const result = editingId
      ? await supabase.rpc("update_treasury_transaction", { p_transaction_id: editingId, ...values })
      : await supabase.rpc("create_treasury_transaction", values);
    if (result.error) setError(result.error.message);
    else {
      setError(""); setSaved(editingId ? "Movimiento actualizado y auditado." : "Movimiento registrado.");
      setDraft({ ...emptyDraft(), transaction_date: dateInTijuana() }); setEditingId(null); await load();
    }
  }
  async function voidMovement(row: Transaction) {
    if (!supabase || row.status !== "active") return;
    const reason = window.prompt(`Motivo para anular "${row.description}":`);
    if (reason === null) return;
    if (!reason.trim()) { setError("Escribe un motivo para dejar constancia de la anulación."); return; }
    if (!window.confirm("El movimiento quedará anulado y no contará en el saldo. ¿Continuar?")) return;
    const result = await supabase.rpc("void_treasury_transaction", { p_transaction_id: row.id, p_reason: reason.trim() });
    if (result.error) setError(result.error.message);
    else { setError(""); setSaved("Movimiento anulado con trazabilidad."); await load(); }
  }

  const content = <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm font-bold uppercase tracking-wide text-[#b18b4a]">Administración</p><h1 className="text-2xl font-bold">Tesorería y aportaciones</h1></div>
    </div>
    <section aria-label="Resumen financiero" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <div className="card-panel col-span-2 p-3 sm:col-span-1"><p className="text-xs uppercase text-slate-500">Saldo actual</p><p className="text-xl font-black text-[#13263d]">{money(entradas - salidas)}</p></div>
      <div className="card-panel p-3"><p className="text-xs uppercase text-slate-500">Entradas</p><p className="text-lg font-black text-emerald-700">{money(entradas)}</p></div>
      <div className="card-panel p-3"><p className="text-xs uppercase text-slate-500">Salidas</p><p className="text-lg font-black text-red-700">{money(salidas)}</p></div>
      <div className="card-panel p-3"><p className="text-xs uppercase text-slate-500">Eventos activos</p><p className="text-lg font-black">{activeEventCount}</p></div>
      <div className="card-panel p-3"><p className="text-xs uppercase text-slate-500">Aportaciones pendientes</p><p className="text-lg font-black">{money(pendingContributions)}</p></div>
    </section>
    {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {saved && <div role="status" className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{saved}</div>}
    <nav aria-label="Secciones de tesorería" className="no-print mb-3 grid gap-2 sm:grid-cols-3">
      {([["events", "Eventos y aportaciones"], ["movements", "Entradas y salidas"], ["report", "Estado de cuenta y reportes"]] as const).map(([key, label]) =>
        <button key={key} type="button" aria-expanded={section === key} aria-controls={`treasury-${key}`} className={`min-h-12 rounded-lg border p-3 text-left font-bold ${section === key ? "bg-[#13263d] text-white" : "bg-white"}`} onClick={() => setSection(key)}>{section === key ? "▾" : "▸"} {label}</button>)}
    </nav>
    <section id="treasury-events" hidden={section !== "events"} aria-label="Eventos y aportaciones">
      <Contributions embedded onChanged={() => void load()} />
    </section>
    {canManage && <section id="treasury-movements" hidden={section !== "movements"} className="no-print mb-5 card-panel p-4">
      <h2 className="mb-3 font-bold">{editingId ? "Editar movimiento" : "Nuevo movimiento"}</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <label><span>Fecha</span><input type="date" value={draft.transaction_date} onChange={(e) => setDraft({ ...draft, transaction_date: e.target.value })}/></label>
        <label className="md:col-span-2"><span>Descripción</span><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/></label>
        <label><span>Importe MXN</span><input type="number" min="0" max="9999999999.99" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })}/></label>
        <label><span>Tipo</span><select value={draft.transaction_type} onChange={(e) => setDraft({ ...draft, transaction_type: e.target.value as Draft["transaction_type"] })}><option value="entrada">Entrada</option><option value="salida">Salida</option></select></label>
        <label><span>Categoría</span><select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label>
        <label><span>Evento relacionado</span><select value={draft.event_id} onChange={(e) => setDraft({ ...draft, event_id: e.target.value })}><option value="">Sin evento</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        <label className="md:col-span-4"><span>Observaciones</span><input value={draft.observations ?? ""} onChange={(e) => setDraft({ ...draft, observations: e.target.value })}/></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="primary" onClick={() => void saveMovement()}>{editingId ? "Guardar cambios" : "Registrar movimiento"}</button>
        {editingId && <button className="border bg-white" onClick={() => { setEditingId(null); setDraft(emptyDraft()); }}>Cancelar edición</button>}
      </div>
    </section>}
    <section id="treasury-report" hidden={section !== "report"} className="card-panel p-4">
      {canExport && <div className="no-print mb-3 flex flex-wrap gap-2"><button className="border bg-white" onClick={() => exportCsv(filtered, events, runningBalances)}>Exportar CSV</button><button className="border bg-white" onClick={() => window.print()}>Exportar PDF</button></div>}
      <h2 className="mb-3 font-bold">Historial de movimientos</h2>
      <div className="no-print mb-4 grid gap-2 md:grid-cols-3">
        <input aria-label="Buscar descripción" placeholder="Buscar descripción" value={query} onChange={(e) => setQuery(e.target.value)}/>
        <input aria-label="Fecha inicial" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}/>
        <input aria-label="Fecha final" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}/>
        <select aria-label="Filtrar por tipo" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">Todos los tipos</option><option value="entrada">Entradas</option><option value="salida">Salidas</option></select>
        <select aria-label="Filtrar por categoría" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Todas las categorías</option>{categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select>
        <select aria-label="Filtrar por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="active">Activos</option><option value="voided">Anulados</option><option value="all">Todos</option></select>
        <select aria-label="Filtrar por evento" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}><option value="">Todos los eventos</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select>
      </div>
      {loading ? <p>Cargando...</p> : filtered.length ? <div className="space-y-2">{filtered.map((row) => <article key={row.id} className={`rounded-lg border p-3 text-sm ${row.status === "voided" ? "bg-slate-50 text-slate-500" : "bg-white"}`}>
        <div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs text-slate-500">{row.transaction_date} · {categoryLabel(row.category)} · {row.status === "active" ? "Activo" : "Anulado"}</p><p className="font-semibold">{row.description}</p></div><p className={`font-black ${row.transaction_type === "entrada" ? "text-emerald-700" : "text-red-700"}`}>{row.transaction_type === "entrada" ? "+" : "−"}{money(Number(row.amount))}</p></div>
        <p className="mt-1 text-xs text-slate-600">Saldo acumulado: {money(runningBalances.get(row.id) ?? 0)}{row.void_reason ? ` · Anulado: ${row.void_reason}` : ""}</p>
        {canManage && row.status === "active" && <div className="no-print mt-2 flex flex-wrap gap-2"><button className="border bg-white" onClick={() => { startEdit(row); setSection("movements"); }} disabled={!!row.fundraising_payment_id} title={row.fundraising_payment_id ? "Editar desde Eventos y aportaciones" : "Editar movimiento"}>Editar</button><button className="border border-red-200 bg-white text-red-700" onClick={() => void voidMovement(row)}>Anular</button></div>}
      </article>)}</div> : <p className="text-sm text-slate-500">No hay movimientos para los filtros seleccionados.</p>}
    </section>
  </>;
  return embedded ? content : <ModuleShell>{content}</ModuleShell>;
}

function categoryLabel(category: string) {
  return ({ donacion: "Donación", aportacion: "Aportación", venta: "Venta", gasto: "Gasto", retiro: "Retiro", otro: "Otro" } as Record<string, string>)[category] ?? category;
}
