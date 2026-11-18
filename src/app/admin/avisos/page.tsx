"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { SERVER_CLASSES, serverClassLabel, type ServerClassId } from "@/lib/server-classes";
import { createClient } from "@/lib/supabase/client";

type Notice = { id: string; title: string; description: string; status: "draft" | "published" | "archived"; priority: string; audience_type: "all" | "class" | "selected"; audience_class_id: string | null; published_at: string | null; expires_at: string | null; activity_id: string | null; announcement_recipients: { person_id: string }[] };
type Person = { id: string; first_name: string; last_name: string; display_name: string | null };
type Activity = { id: string; name: string; activity_date: string };
type Draft = Omit<Notice, "id" | "published_at" | "announcement_recipients"> & { id?: string; published_at?: string | null; selected_people: string[]; expiry_date: string };
const emptyDraft = (): Draft => ({ title: "", description: "", status: "draft", priority: "normal", audience_type: "all", audience_class_id: null, activity_id: null, expires_at: null, published_at: null, selected_people: [], expiry_date: "" });

export default function NoticeAdminPage() {
  const supabase = useMemo(() => createClient(), []);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!supabase) { setError("Supabase no está configurado."); setLoading(false); return; }
    const [noticesResult, peopleResult, activitiesResult] = await Promise.all([
      supabase.from("announcements").select("id,title,description,status,priority,audience_type,audience_class_id,published_at,expires_at,activity_id,announcement_recipients(person_id)").order("updated_at", { ascending: false }),
      supabase.from("people").select("id,first_name,last_name,display_name").order("first_name"),
      supabase.from("community_activities").select("id,name,activity_date").gte("activity_date", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())).order("activity_date"),
    ]);
    const firstError = noticesResult.error ?? peopleResult.error ?? activitiesResult.error;
    if (firstError) setError(firstError.message);
    else {
      setNotices((noticesResult.data ?? []) as Notice[]);
      setPeople((peopleResult.data ?? []) as Person[]);
      setActivities((activitiesResult.data ?? []) as Activity[]);
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  function startEdit(notice: Notice) {
    setError(""); setMessage("");
    setDraft({ ...notice, selected_people: (notice.announcement_recipients ?? []).map((recipient) => recipient.person_id), expiry_date: notice.expires_at?.slice(0, 10) ?? "" });
  }
  async function save() {
    if (!supabase || !draft || busy) return;
    setError(""); setMessage("");
    if (draft.audience_type === "selected" && !draft.selected_people.length) { setError("Selecciona al menos un servidor destinatario."); return; }
    setBusy(true);
    const params = {
      p_title: draft.title,
      p_description: draft.description,
      p_expires_at: draft.expiry_date ? new Date(`${draft.expiry_date}T23:59:59`).toISOString() : null,
      p_activity_id: draft.activity_id || null,
      p_priority: draft.priority,
      p_audience_type: draft.audience_type,
      p_audience_class_id: draft.audience_type === "class" ? draft.audience_class_id : null,
      p_person_ids: draft.audience_type === "selected" ? draft.selected_people : [],
      p_status: draft.status,
    };
    const result = draft.id
      ? await supabase.rpc("update_announcement", { p_announcement_id: draft.id, ...params })
      : await supabase.rpc("create_announcement", params);
    if (result.error) setError(result.error.message);
    else { setDraft(null); setMessage(draft.id ? "Aviso actualizado." : "Aviso creado."); await load(); }
    setBusy(false);
  }
  function setStatus(notice: Notice, status: Notice["status"]) {
    if (!supabase || busy) return;
    setBusy(true); setError(""); setMessage("");
    void supabase.rpc("set_announcement_status", { p_announcement_id: notice.id, p_status: status })
      .then(async ({ error: updateError }) => {
        if (updateError) setError(updateError.message);
        else { setMessage("Estado del aviso actualizado."); await load(); }
        setBusy(false);
      });
  }
  function personLabel(person: Person) { return person.display_name || `${person.first_name} ${person.last_name}`.trim(); }
  const classOptions = SERVER_CLASSES as readonly { id: ServerClassId; label: string }[];

  return <ModuleShell><section className="card-panel p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Administrar avisos</h1><p className="mt-1 text-sm text-slate-600">Publica avisos para todos, una clase o servidores específicos.</p></div><button className="primary" disabled={busy} onClick={() => { setError(""); setDraft(emptyDraft()); }}>+ Nuevo aviso</button></div>
    {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mb-4 text-emerald-800">{message}</p>}
    {draft && <form className="mb-6 space-y-4 rounded-lg border bg-slate-50 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2 className="text-lg font-bold">{draft.id ? "Editar aviso" : "Nuevo aviso"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Título<input required maxLength={180} disabled={busy} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
        <label>Prioridad<select disabled={busy} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>{[["low", "Baja"], ["normal", "Normal"], ["high", "Alta"], ["urgent", "Urgente"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Vencimiento opcional<input type="date" disabled={busy} value={draft.expiry_date} onChange={(event) => setDraft({ ...draft, expiry_date: event.target.value })}/></label>
        <label>Actividad relacionada opcional<select disabled={busy} value={draft.activity_id ?? ""} onChange={(event) => setDraft({ ...draft, activity_id: event.target.value || null })}><option value="">Sin actividad</option>{activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name} · {activity.activity_date}</option>)}</select></label>
        <label>Destinatarios<select disabled={busy} value={draft.audience_type} onChange={(event) => setDraft({ ...draft, audience_type: event.target.value as Draft["audience_type"], audience_class_id: null, selected_people: [] })}><option value="all">Todos</option><option value="class">Clase o grupo</option><option value="selected">Servidores seleccionados</option></select></label>
        <label>Estado<select disabled={busy} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft["status"] })}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="archived">Archivado</option></select></label>
        {draft.audience_type === "class" && <label>Clase o grupo<select required disabled={busy} value={draft.audience_class_id ?? ""} onChange={(event) => setDraft({ ...draft, audience_class_id: event.target.value || null })}><option value="">Selecciona una clase</option>{classOptions.map((item) => <option key={item.id} value={item.id}>{serverClassLabel(item.id)}</option>)}</select></label>}
      </div>
      {draft.audience_type === "selected" && <fieldset className="rounded border bg-white p-3"><legend className="px-1 font-bold">Servidores destinatarios</legend><div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">{people.map((person) => <label className="checkbox-field text-sm" key={person.id}><input disabled={busy} type="checkbox" checked={draft.selected_people.includes(person.id)} onChange={(event) => setDraft({ ...draft, selected_people: event.target.checked ? [...draft.selected_people, person.id] : draft.selected_people.filter((id) => id !== person.id) })}/><span>{personLabel(person)}</span></label>)}</div></fieldset>}
      <label>Descripción<textarea required maxLength={10000} rows={5} disabled={busy} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
      <div className="flex flex-wrap gap-2"><button className="primary" disabled={busy}>{busy ? "Guardando..." : draft.id ? "Guardar cambios" : "Crear aviso"}</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button></div>
    </form>}
    <h2 className="mb-3 text-lg font-bold">Avisos existentes</h2>
    {loading ? <p role="status">Cargando avisos...</p> : notices.length ? <div className="space-y-3">{notices.map((notice) => <article key={notice.id} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{notice.status === "draft" ? "Borrador" : notice.status === "published" ? "Publicado" : "Archivado"}</span><span className="ml-2 text-xs font-semibold uppercase text-slate-500">{notice.priority}</span><h3 className="mt-2 text-lg font-bold">{notice.title}</h3></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => startEdit(notice)}>Editar</button>{notice.status !== "published" && <button className="primary" disabled={busy} onClick={() => setStatus(notice, "published")}>Publicar</button>}{notice.status !== "archived" && <button disabled={busy} onClick={() => setStatus(notice, "archived")}>Archivar</button>}</div></div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{notice.description}</p><p className="mt-2 text-xs text-slate-500">Destinatarios: {notice.audience_type === "all" ? "Todos" : notice.audience_type === "class" ? serverClassLabel(notice.audience_class_id as ServerClassId | null) : "Servidores seleccionados"}</p>
    </article>)}</div> : <p className="text-slate-600">Aún no hay avisos.</p>}
  </section></ModuleShell>;
}
