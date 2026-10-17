"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { CalendarDays, Copy, Download, Image as ImageIcon, LogOut, Plus, Save, Search, Send, Settings, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AutoAssignmentControls } from "@/components/auto-assignment-controls";
import { canAssignToService } from "@/lib/commission-assignments";
import { previewAssignmentNames, repeatedPersonIds } from "@/lib/commission-preview";

import { fixedServiceText, isMassService, getRequiredAssignmentCount, hasFixedAssignmentCount, assignmentRows } from "@/lib/service-rules";
import { statusLabel, statusTransitions } from "@/lib/commission-status";

import { permissionsFor, type AppRole } from "@/lib/permissions";
type Role = AppRole;
type Category = { id: string; name: string; display_order: number };
type Service = { id: string; stable_key: string | null; slug: string | null; category_id: string; name: string; allow_multiple_people: boolean; active: boolean; display_order: number };
type Person = { id: string; first_name: string; last_name: string; display_name: string | null; phone: string | null; whatsapp: string | null; email: string | null; gender: string | null; active: boolean; notes: string | null; services: string[] };
type MassTime = { id: string; name: string; time: string; active: boolean; display_order: number };
type Parish = { id: string; name: string; logo_url: string | null; patron_image_url: string | null; address: string | null; phone: string | null };
type SettingsRow = { women_clothing: string | null; men_clothing: string | null; general_clothing: string | null; default_notes: string | null; allow_multiple_services: boolean };
type Mass = { id?: string; parish_id: string; mass_date: string; mass_time_id: string; title: string; subtitle: string | null; liturgical_cycle: string | null; status: string; liturgical_text_title: string | null; liturgical_text: string | null; liturgical_text_reference: string | null; image_url: string | null; notes: string | null };
type Availability = { person_id: string; mass_date: string; mass_time_id: string | null; status: "available" | "unavailable" | "pending" };
type AssignmentMap = Record<string, string[]>;

const parishId = "00000000-0000-0000-0000-000000000001";
const blankSettings: SettingsRow = { women_clothing: "", men_clothing: "", general_clothing: "", default_notes: "", allow_multiple_services: false };
const emptyMass = (timeId = ""): Mass => ({ parish_id: parishId, mass_date: "2026-10-13", mass_time_id: timeId, title: "Domingo del Tiempo Ordinario", subtitle: "", liturgical_cycle: "", status: "draft", liturgical_text_title: "", liturgical_text: "", liturgical_text_reference: "", image_url: "", notes: "" });

export default function Dashboard() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const previewRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>("LECTOR");
  const [parish, setParish] = useState<Parish>({ id: parishId, name: "Parroquia", logo_url: null, patron_image_url: null, address: null, phone: null });
  const [settings, setSettings] = useState<SettingsRow>(blankSettings);
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [massTimes, setMassTimes] = useState<MassTime[]>([]);
  const [masses, setMasses] = useState<Mass[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [mass, setMass] = useState<Mass>(emptyMass());
  const [assignments, setAssignments] = useState<AssignmentMap>({});
  const [editingUnlocked, setEditingUnlocked] = useState(false);
  const [originalStatus, setOriginalStatus] = useState("draft");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState("Cambios pendientes");
  const canEdit = permissionsFor(role).editCommissions;
  const canAdmin = permissionsFor(role).manageConfiguration;
  const massId = pathname.match(/^\/comisiones\/([^/]+)/)?.[1];
  const personId = pathname.match(/^\/servidores\/([^/]+)/)?.[1];

  const loadAll = useCallback(async () => {
    if (!supabase) { setError("Supabase no está configurado. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."); setLoading(false); return; }
    setLoading(true); setError("");
    const { data: userData } = await supabase.auth.getUser();
    const profilePromise = userData.user ? supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle() : Promise.resolve({ data: null, error: null });
    const [profileRes, parishRes, catRes, svcRes, peopleRes, timesRes, settingsRes, massesRes, availabilityRes] = await Promise.all([
      profilePromise,
      supabase.from("parishes").select("*").eq("id", parishId).single(),
      supabase.from("service_categories").select("*").order("display_order"),
      supabase.from("services").select("*").order("display_order"),
      supabase.from("people").select("*, person_services(service_id)").order("first_name"),
      supabase.from("mass_times").select("*").eq("parish_id", parishId).order("display_order"),
      supabase.from("parish_settings").select("women_clothing, men_clothing, general_clothing, default_notes, allow_multiple_services").eq("parish_id", parishId).maybeSingle(),
      supabase.from("masses").select("*").eq("parish_id", parishId).order("mass_date", { ascending: false }),
      supabase.from("person_availability").select("person_id, mass_date, mass_time_id, status"),
    ]);
    const firstError = [parishRes, catRes, svcRes, peopleRes, timesRes, settingsRes, massesRes, availabilityRes].find((r) => r.error)?.error;
    if (firstError) setError(firstError.message);
    if (profileRes.data?.role) setRole(profileRes.data.role as Role);
    if (parishRes.data) setParish(parishRes.data as Parish);
    setCategories((catRes.data ?? []) as Category[]);
    setServices((svcRes.data ?? []) as Service[]);
    setPeople(((peopleRes.data ?? []) as Array<Person & { person_services?: { service_id: string }[] }>).map((p) => ({ ...p, services: p.person_services?.map((s) => s.service_id) ?? [] })));
    setMassTimes((timesRes.data ?? []) as MassTime[]);
    setSettings((settingsRes.data ?? blankSettings) as SettingsRow);
    setMasses((massesRes.data ?? []) as Mass[]);
    setAvailability((availabilityRes.data ?? []) as Availability[]);
    setMass((current) => current.mass_time_id ? current : emptyMass(timesRes.data?.[0]?.id ?? ""));
    setLoading(false);
  }, [supabase]);

  const loadMass = useCallback(async (id: string) => {
    if (!supabase) return;
    setLoading(true);
    const [massRes, assignRes] = await Promise.all([supabase.from("masses").select("*").eq("id", id).single(), supabase.from("mass_assignments").select("service_id, person_id, display_order").eq("mass_id", id).order("display_order")]);
    if (massRes.error || assignRes.error) setError(massRes.error?.message || assignRes.error?.message || "Error al cargar comisión");
    if (massRes.data) { setMass(massRes.data as Mass); setOriginalStatus(massRes.data.status); setEditingUnlocked(false); }
    const next: AssignmentMap = {};
    assignRes.data?.forEach((row) => { (next[row.service_id] ??= [])[row.display_order] = row.person_id; });
    if (massRes.data) {
      const cleaning = await supabase.from("cleaning_assignments").select("service_id,person_id,display_order").eq("mass_id", id).order("display_order");
      if (cleaning.error) { setError(cleaning.error.message); setLoading(false); return; }
      cleaning.data?.forEach((row) => { if (row.service_id) (next[row.service_id] ??= [])[row.display_order] = row.person_id; });
    }
    setAssignments(next); setLoading(false);
  }, [supabase]);

  useEffect(() => { window.setTimeout(() => { void loadAll(); }, 0); }, [loadAll]);
  useEffect(() => {
    if (massId && massId !== "nueva" && massId !== mass.id) window.setTimeout(() => { void loadMass(massId); }, 0);
    if (pathname === "/comisiones/nueva") { window.setTimeout(() => { setMass(emptyMass(massTimes[0]?.id ?? "")); setAssignments({}); setOriginalStatus("draft"); setEditingUnlocked(false); }, 0); }
  }, [loadMass, mass.id, massId, pathname, massTimes]);
  async function saveMass(nextStatus?: string) {
    if (!supabase || !canEdit) return;
    if (["finished", "published"].includes(originalStatus) && !editingUnlocked && !nextStatus) return;
    const savingMass = { ...mass, status: nextStatus ?? mass.status };
    setSaved("Guardando...");
    const payload = { p_mass_id: mass.id ?? null, p_parish_id: parish.id, p_mass_date: mass.mass_date, p_mass_time_id: mass.mass_time_id, p_title: mass.title, p_subtitle: mass.subtitle, p_liturgical_cycle: mass.liturgical_cycle, p_status: savingMass.status, p_liturgical_text_title: mass.liturgical_text_title, p_liturgical_text: mass.liturgical_text, p_liturgical_text_reference: mass.liturgical_text_reference, p_image_url: mass.image_url, p_notes: mass.notes, p_assignments: assignmentRows(assignments, services) };
    const { data, error: rpcError } = await supabase.rpc("save_mass_with_assignments", payload);
    if (rpcError) { setSaved("Error al guardar"); setError(`No se pudo guardar la comisión completa: ${rpcError.message}`); return; }
    setMass(savingMass); setOriginalStatus(savingMass.status); setEditingUnlocked(false); setSaved("Guardado en Supabase"); await loadAll(); router.push(`/comisiones/${String(data)}/editar`);
  }

  function label(person?: Person) { return person ? person.display_name || `${person.first_name} ${person.last_name}`.trim() : "Sin asignar"; }
  function peopleFor(service: Service) {
    return people.filter((p) => p.active && p.services.includes(service.id)
      && label(p).toLowerCase().includes(query.toLowerCase())
      && canAssignToService(assignments, service.id, p.id, settings.allow_multiple_services, services))
      .map((p) => { const av = availability.find((a) => a.person_id === p.id && a.mass_date === mass.mass_date && a.mass_time_id === mass.mass_time_id); const state = av?.status === "unavailable" ? "No disponible" : av?.status === "pending" ? "Pendiente" : "Disponible"; return { ...p, state }; });
  }
  function changeAssignment(service: Service, index: number, value: string) { const picked = peopleFor(service).find((p) => p.id === value); if (picked?.state === "No disponible" && !window.confirm("Esta persona está marcada como No disponible. ¿Deseas asignarla de todos modos?")) return; if (value && (assignments[service.id] ?? []).some((id, i) => i !== index && id === value)) return; const current = assignments[service.id] ?? []; const next = [...current]; next[index] = value; setAssignments({ ...assignments, [service.id]: next }); setSaved("Cambios pendientes"); }
  async function exportPng(downloadOnly = false) {
    if (!previewRef.current) return null;
    await Promise.all(Array.from(previewRef.current.querySelectorAll("img")).map((img) => img.decode().catch(() => undefined)));
    const { scrollWidth, scrollHeight } = previewRef.current;
    const dataUrl = await toPng(previewRef.current, {
      pixelRatio: 2, backgroundColor: "#ffffff", width: scrollWidth, height: scrollHeight,
    });
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `comision-${mass.mass_date}.png`, { type: "image/png" });
    if (downloadOnly) { const link = document.createElement("a"); link.href = dataUrl; link.download = file.name; link.click(); }
    return file;
  }
  async function shareImage() {
    const file = await exportPng(false); if (!file) return;
    const text = `Comisiones para la Santa Misa\n${parish.name}\n${formatDate(mass.mass_date)} ${timeName(massTimes, mass.mass_time_id)}`;
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ title: "Comisiones para la Santa Misa", text, files: [file] }); return; }
    await exportPng(true); window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\nAdjunta la imagen PNG descargada.`)}`, "_blank");
  }

  if (loading) return <Shell role={role}><State text="Cargando..." /></Shell>;
  if (error) return <Shell role={role}><State text={`Error al cargar: ${error}`} /></Shell>;
  return <Shell role={role} onLogout={async () => { await supabase?.auth.signOut(); router.push("/login"); }}>
    {pathname === "/" && <Home masses={masses} people={people} services={services} massTimes={massTimes} />}
    {pathname.startsWith("/comisiones") && <Commissions path={pathname} masses={masses} mass={mass} setMass={setMass} massTimes={massTimes} services={services} categories={categories} assignments={assignments} setAssignments={setAssignments} peopleFor={peopleFor} personName={(id) => label(people.find((p) => p.id === id))} query={query} setQuery={setQuery} canEdit={canEdit && (!["published", "finished"].includes(originalStatus) || editingUnlocked)} canManage={canEdit} onUnlock={() => { if (originalStatus !== "published" || window.confirm("Esta comisión ya está confirmada. ¿Deseas modificarla?")) setEditingUnlocked(true); }} onStatusChange={(status) => { if (window.confirm(`¿Cambiar la comisión a ${statusLabel(status)}? Se guardarán los cambios actuales.`)) void saveMass(status); }} saved={saved} onSave={() => void saveMass()} onDuplicate={() => { setMass({ ...mass, id: undefined, mass_date: "2026-10-13" }); router.push("/comisiones/nueva"); }} onChange={changeAssignment} previewRef={previewRef} parish={parish} settings={settings} onDownload={() => void exportPng(true)} onShare={() => void shareImage()} assignmentTools={canEdit && (!["published", "finished"].includes(originalStatus) || editingUnlocked) && mass.parish_id === parish.id ? <AutoAssignmentControls key={`${mass.id ?? "new"}:${mass.mass_date}:${mass.mass_time_id}`} parishId={parish.id} massId={mass.id} date={mass.mass_date} massTimeId={mass.mass_time_id} time={massTimes.find((time) => time.id === mass.mass_time_id)?.time ?? ""} people={people} services={services} assignments={assignments} allowMultipleServices={settings.allow_multiple_services} onGenerated={(next) => { setAssignments(next); setSaved("Cambios pendientes"); setQuery(""); }}/> : null} />}
    {pathname.startsWith("/servidores") && <PeopleView canEdit={canEdit} personId={personId} people={people} services={services} categories={categories} reload={loadAll} />}
    {pathname === "/admin/servicios" && <ServicesAdmin canAdmin={canAdmin} categories={categories} services={services} reload={loadAll} />}
    {pathname === "/admin/horarios" && <TimesAdmin canAdmin={canAdmin} massTimes={massTimes} reload={loadAll} />}
    {pathname === "/admin/parroquia" && <ParishAdmin canAdmin={canAdmin} parish={parish} reload={loadAll} />}
    {pathname === "/admin/configuracion" && <SettingsAdmin canAdmin={canAdmin} settings={settings} reload={loadAll} />}
  </Shell>;
}

export function Shell({ children, role, onLogout }: { children: React.ReactNode; role: Role; onLogout?: () => void }) {
  const currentPath = usePathname() || "/";
  const nav = [["/comisiones", "Comisiones"], ["/servidores", "Servidores"], ["/admin/servicios", "Servicios"], ["/admin/horarios", "Horarios"], ["/admin/parroquia", "Parroquia"], ["/admin/configuracion", "Configuración"], ["/admin/usuarios", "Usuarios"]].filter(([href]) => !href.startsWith("/admin") || permissionsFor(role).manageConfiguration);
  return <div className="min-h-screen bg-[#f7f8fa] text-slate-900"><header className="sticky top-0 z-20 border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-8"><Link href="/" className="font-serif text-xl font-bold text-[#13263d]">Santo Toribio Romo</Link><nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-600">{nav.map(([href, name]) => <Link key={href} href={href} className={`nav-link ${currentPath === href || currentPath.startsWith(`${href}/`) ? "nav-link-active" : ""}`}>{name}</Link>)}<span className="status-pill">{role}</span>{onLogout && <button onClick={onLogout} className="border border-slate-300 bg-white text-slate-700 hover:border-[#13263d] hover:text-[#13263d]" aria-label="Salir"><LogOut size={17}/></button>}</nav></div></header><main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8">{children}</main></div>;
}
function State({ text }: { text: string }) { return <div className="card-panel p-6 text-slate-600">{text}</div>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function timeName(times: MassTime[], id: string) { return times.find((t) => t.id === id)?.name ?? "Sin hora"; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>{children}</label>; }
function Home({ masses, people, services, massTimes }: { masses: Mass[]; people: Person[]; services: Service[]; massTimes: MassTime[] }) { return <><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-wide text-[#b18b4a]">Panel de coordinación</p><h1 className="text-3xl font-bold text-[#13263d]">Comisiones para la Santa Misa</h1></div><Link className="button-link primary bg-[#13263d] text-sm text-white hover:bg-[#1d3a5b]" href="/comisiones/nueva"><Plus size={17}/> Nueva comisión</Link></div><div className="grid gap-4 md:grid-cols-3"><Stat label="Comisiones" value={String(masses.length)} icon={<CalendarDays/>}/><Stat label="Servidores" value={String(people.length)} icon={<Users/>}/><Stat label="Servicios" value={String(services.length)} icon={<Settings/>}/></div><section className="mt-7 rounded-lg border bg-white p-5"><h2 className="mb-4 text-lg font-bold">Próximas comisiones</h2>{masses.length ? masses.map((m) => <Link key={m.id} href={`/comisiones/${m.id}`} className="flex justify-between border-t py-3 text-sm"><span>{m.title}</span><span>{formatDate(m.mass_date)} · {timeName(massTimes, m.mass_time_id)}</span></Link>) : <State text="No hay datos" />}</section></>; }
function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) { return <div className="flex items-center gap-4 rounded-lg border bg-white p-5"><span className="text-[#13263d]">{icon}</span><div><p className="text-xs uppercase text-slate-500">{label}</p><p className="text-2xl font-black text-[#13263d]">{value}</p></div></div>; }

function Commissions(props: { path: string; masses: Mass[]; mass: Mass; setMass: React.Dispatch<React.SetStateAction<Mass>>; massTimes: MassTime[]; services: Service[]; categories: Category[]; assignments: AssignmentMap; setAssignments: (a: AssignmentMap) => void; peopleFor: (s: Service) => Array<Person & { state: string }>; personName: (id: string) => string; query: string; setQuery: (q: string) => void; canEdit: boolean; canManage?: boolean; onUnlock?: () => void; onStatusChange?: (status: string) => void; saved: string; onSave: () => void; onDuplicate: () => void; onChange: (s: Service, i: number, p: string) => void; previewRef: React.RefObject<HTMLDivElement | null>; parish: Parish; settings: SettingsRow; onDownload: () => void; onShare: () => void; assignmentTools?: React.ReactNode }) {
  const [dateFilter, setDateFilter] = useState("");
  const [timeFilter, setTimeFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [liturgyStatus, setLiturgyStatus] = useState("");
  const liturgyRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { liturgyRequest.current?.abort(); liturgyRequest.current = null; }, [props.path]);

  async function changeDate(date: string) {
    liturgyRequest.current?.abort();
    liturgyRequest.current = null;
    const snapshot = props.mass;
    props.setMass((current) => ({ ...current, mass_date: date }));
    if (!date) { setLiturgyStatus(""); return; }
    const controller = new AbortController();
    liturgyRequest.current = controller;
    setLiturgyStatus("Cargando información litúrgica...");
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/liturgia?date=${encodeURIComponent(date)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Liturgical lookup failed");
      const data: { celebration?: unknown; subtitle?: unknown } = await response.json();
      if (typeof data.celebration !== "string" || !data.celebration.trim()
        || (data.subtitle !== null && typeof data.subtitle !== "string")) throw new Error("Invalid liturgical response");
      if (controller.signal.aborted) return;
      const celebration = data.celebration;
      const subtitle = data.subtitle as string | null;
      props.setMass((current) => current.mass_date !== date || current.id !== snapshot.id ? current : {
        ...current,
        title: current.title === snapshot.title ? celebration : current.title,
        subtitle: current.subtitle === snapshot.subtitle ? subtitle : current.subtitle,
      });
      setLiturgyStatus("Información litúrgica cargada");
    } catch {
      if (liturgyRequest.current === controller) setLiturgyStatus("No se pudo obtener la información litúrgica automáticamente.");
    } finally {
      window.clearTimeout(timeout);
    }
  }
  if (props.path === "/comisiones") {
    const filtered = props.masses.filter((m) => (!dateFilter || m.mass_date === dateFilter) && (!timeFilter || m.mass_time_id === timeFilter) && (!statusFilter || m.status === statusFilter) && (!personFilter || m.title.toLowerCase().includes(personFilter.toLowerCase())));
    return <><div className="mb-5 flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Comisiones</h1>{props.canEdit && <Link className="button-link primary bg-[#13263d] text-sm text-white hover:bg-[#1d3a5b]" href="/comisiones/nueva"><Plus size={17}/> Nueva comisión</Link>}</div><div className="mb-5 grid gap-3 card-panel p-4 md:grid-cols-4"><input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /><select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}><option value="">Todos los horarios</option>{props.massTimes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><input placeholder="Persona o celebración" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} /><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">Todos los estados</option><option value="draft">Borrador</option><option value="published">Confirmada</option><option value="finished">Realizada</option><option value="cancelled">Cancelada</option></select></div>{filtered.length ? filtered.map((m) => <Link key={m.id} href={`/comisiones/${m.id}`} className="mb-3 grid gap-2 card-panel p-4 text-sm transition hover:border-[#13263d] hover:shadow-md md:grid-cols-4"><b>{formatDate(m.mass_date)}</b><span>{timeName(props.massTimes, m.mass_time_id)}</span><span>{m.title}</span><StatusBadge status={m.status}/></Link>) : <State text="No hay datos" />}</>;
  }
  const previewOnly = props.path.endsWith("/preview") || (props.path !== "/comisiones/nueva" && /^\/comisiones\/[^/]+$/.test(props.path));
  const statusActions = <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={props.mass.status}/>{props.canManage && <>{!props.canEdit && <button onClick={props.onUnlock}>{props.mass.status === "finished" ? "Editar de todos modos" : "Modificar comisión"}</button>}{statusTransitions(props.mass.status).map((status) => <button key={status} onClick={() => props.onStatusChange?.(status)}>{status === "published" ? "Confirmar comisión" : status === "finished" ? "Marcar como realizada" : status === "cancelled" ? "Cancelar" : props.mass.status === "cancelled" ? "Reactivar como borrador" : props.mass.status === "finished" ? "Reabrir" : "Volver a borrador"}</button>)}</>}</div>;
  return <div className={previewOnly ? "mx-auto max-w-[780px]" : "grid gap-7 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"}>
    <div className="col-span-full">{statusActions}</div>
    {!previewOnly && <section className="card-panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">{props.mass.id ? "Editar comisión" : "Nueva comisión"}</h1><span className="text-sm text-slate-500">{props.saved}</span></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Fecha"><input disabled={!props.canEdit} type="date" value={props.mass.mass_date} onChange={(e) => void changeDate(e.target.value)}/></Field><Field label="Hora"><select disabled={!props.canEdit} value={props.mass.mass_time_id} onChange={(e) => props.setMass({ ...props.mass, mass_time_id: e.target.value })}>{props.massTimes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Celebración"><input disabled={!props.canEdit} value={props.mass.title} onChange={(e) => props.setMass({ ...props.mass, title: e.target.value })}/></Field><Field label="Subtítulo"><input disabled={!props.canEdit} value={props.mass.subtitle ?? ""} onChange={(e) => props.setMass({ ...props.mass, subtitle: e.target.value })}/></Field><Field label="Estado"><select disabled={!props.canManage} value={props.mass.status} onChange={(e) => props.onStatusChange?.(e.target.value)}><option value="draft">Borrador</option><option value="published">Confirmada</option><option value="finished">Realizada</option><option value="cancelled">Cancelada</option></select></Field></div>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-600">{liturgyStatus}</p>
      {props.assignmentTools}
      <div className="relative my-5"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input className="w-full rounded-lg border bg-slate-50 py-2.5 pl-10" placeholder="Buscar servidor..." value={props.query} onChange={(e) => props.setQuery(e.target.value)}/></div>
      {props.categories.map((cat) => <div key={cat.id} className="mb-5"><h2 className="mb-2 text-xs font-black uppercase tracking-wide text-[#b18b4a]">{cat.name}</h2>{props.services.filter((s) => s.active && s.category_id === cat.id).map((s) => <div key={s.id} className="mb-3 rounded-lg border bg-slate-50 p-3"><div className="mb-2 flex justify-between"><b>{s.name}</b>{s.allow_multiple_people && !hasFixedAssignmentCount(s) && props.canEdit && <button onClick={() => props.setAssignments({ ...props.assignments, [s.id]: [...(props.assignments[s.id] ?? []), ""] })} className="text-sm font-bold text-[#13263d]">Agregar</button>}</div>{fixedServiceText(s) && <p>Todos</p>}{Array.from({ length: getRequiredAssignmentCount(s, props.assignments[s.id]?.length ?? 0) }).map((_, i) => <select key={`${s.id}-${i}`} disabled={!props.canEdit} className="mb-2 w-full rounded-lg border bg-white p-2" value={props.assignments[s.id]?.[i] ?? ""} onChange={(e) => props.onChange(s, i, e.target.value)}><option value="">No disponible / sin asignar</option>{props.peopleFor(s).filter((p) => !(props.assignments[s.id] ?? []).some((id, index) => index !== i && id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.display_name || `${p.first_name} ${p.last_name}`} - {p.state}</option>)}</select>)}{hasFixedAssignmentCount(s) && getRequiredAssignmentCount(s) > (props.assignments[s.id] ?? []).filter(Boolean).length && <p role="status" className="text-sm text-amber-800">Faltan {getRequiredAssignmentCount(s) - (props.assignments[s.id] ?? []).filter(Boolean).length} servidores para {s.name}.</p>}</div>)}</div>)}
      <Field label="Notas"><textarea disabled={!props.canEdit} rows={3} value={props.mass.notes ?? ""} onChange={(e) => props.setMass({ ...props.mass, notes: e.target.value })}/></Field>
      {props.canEdit && <div className="mt-5 flex flex-wrap gap-2"><button onClick={props.onSave} className="inline-flex min-h-11 items-center gap-2 rounded-lg primary bg-[#13263d] px-4 text-sm font-bold text-white"><Save size={17}/> Guardar</button><button onClick={props.onDuplicate} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-bold"><Copy size={17}/> Duplicar</button><a className="button-link border bg-white" href="#vista-previa">Preview</a></div>}
    </section>}
    {previewOnly && <div className="mb-4 flex flex-wrap gap-2">{props.canEdit && <><Link className="button-link primary" href={`/comisiones/${props.mass.id}/editar`}>Editar</Link><button onClick={props.onDuplicate}><Copy size={17}/> Duplicar</button></>}<Link className="button-link border bg-white" href={`/comisiones/${props.mass.id}/preview`}>Preview</Link></div>}
    <WhatsAppScheduleImage {...props} />
  </div>;
}
function WhatsAppScheduleImage({ previewRef, parish, mass, massTimes, categories, services, assignments, personName, settings, onDownload, onShare }: { previewRef: React.RefObject<HTMLDivElement | null>; parish: Parish; mass: Mass; massTimes: MassTime[]; categories: Category[]; services: Service[]; assignments: AssignmentMap; personName: (id: string) => string; settings: SettingsRow; onDownload: () => void; onShare: () => void }) {
  const repeatedIds = repeatedPersonIds(assignments, services);
  return <section id="vista-previa" className="min-w-0"><div ref={previewRef} className="schedule-preview mx-auto bg-white text-slate-900 shadow-sm"><div className="flex items-center justify-center gap-3"><BrandImage key={parish.patron_image_url || "patron"} src={parish.patron_image_url || "/images/santo-patrono.png"} alt="Santo Patrono"/><div className="min-w-0 flex-1"><p className="text-center text-xs font-black uppercase text-[#b18b4a] sm:text-sm">Comisiones para la Santa Misa</p><h1 className="mt-1 text-center text-xl font-black text-[#13263d] sm:text-2xl">{parish.name}</h1></div><BrandImage key={parish.logo_url || "logo"} src={parish.logo_url || "/images/parish-logo.png"} alt="Logo de la parroquia"/></div><div className="mt-2 text-center"><StatusBadge status={mass.status}/></div><p className="mt-3 text-center text-lg font-bold sm:mt-5 sm:text-xl">{mass.title}</p><p className="text-center text-sm text-slate-500 sm:text-base">{mass.subtitle}</p><div className="my-3 flex flex-wrap justify-center gap-2 border-y py-2 text-base font-bold sm:my-4 sm:py-3 sm:text-lg"><span>{formatDate(mass.mass_date)}</span><span>{timeName(massTimes, mass.mass_time_id)}</span></div><div className="grid gap-2 sm:grid-cols-2 sm:gap-4">{categories.map((cat) => <div key={cat.id} className="rounded-lg bg-slate-50 p-3 sm:p-4"><h2 className="mb-2 text-sm font-black uppercase text-[#b18b4a] sm:mb-3">{cat.name}</h2>{services.filter((s) => s.active && s.category_id === cat.id).map((s) => <p key={s.id} className="mb-1 text-sm sm:mb-2"><b>{s.name}:</b> {fixedServiceText(s) || (getRequiredAssignmentCount(s, assignments[s.id]?.length) > 1 ? <span className="block">{Array.from({ length: getRequiredAssignmentCount(s, assignments[s.id]?.length) }, (_, i) => <span className="block" key={i}>- {previewAssignmentNames([assignments[s.id]?.[i] ?? ""], personName, isMassService(s) ? repeatedIds : new Set())}</span>)}</span> : previewAssignmentNames(assignments[s.id] ?? [], personName, isMassService(s) ? repeatedIds : new Set()))}</p>)}</div>)}</div>{repeatedIds.size > 0 && <p className="mt-3 text-xs text-slate-600 sm:text-sm">* Servidor asignado a más de un servicio.</p>}<div className="mt-3 border-t pt-3 text-sm leading-5 sm:mt-5 sm:pt-4 sm:leading-6"><b>Vestimenta</b><p>Mujeres: {settings.women_clothing || "No configurado"} · Hombres: {settings.men_clothing || "No configurado"} · General: {settings.general_clothing || "No configurado"}</p><p className="mt-1 sm:mt-2"><b>Notas:</b> {mass.notes || settings.default_notes || "Sin notas"}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={onDownload} className="inline-flex min-h-11 items-center gap-2 rounded-lg primary bg-[#13263d] px-4 text-sm font-bold text-white"><ImageIcon size={17}/> Generar PNG</button><button onClick={onShare} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-bold"><Send size={17}/> Compartir</button><button onClick={onDownload} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-bold"><Download size={17}/> Descargar</button></div></section>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { draft: "bg-slate-100 text-slate-700", published: "bg-blue-100 text-blue-800", finished: "bg-emerald-100 text-emerald-800", cancelled: "bg-red-100 text-red-800" };
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${colors[status] ?? colors.draft}`}>{statusLabel(status)}</span>;
}
function BrandImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // Native img is intentional: html-to-image embeds this same preview node.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="h-12 w-12 shrink-0 object-contain sm:h-16 sm:w-16"/>;
}

function PeopleView({ canEdit, personId, people, services, categories, reload }: { canEdit: boolean; personId?: string; people: Person[]; services: Service[]; categories: Category[]; reload: () => Promise<void> }) {
  const supabase = createClient();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const editing = personId && personId !== "nuevo" ? people.find((p) => p.id === personId) : null;
  const [form, setForm] = useState<Person>(editing ?? { id: "", first_name: "", last_name: "", display_name: "", phone: "", whatsapp: "", email: "", gender: "female", active: true, notes: "", services: [] });
  useEffect(() => { if (editing) window.setTimeout(() => setForm(editing), 0); }, [editing]);
  async function save() {
    if (!supabase || !canEdit) return;
    const row = { parish_id: parishId, first_name: form.first_name, last_name: form.last_name, display_name: form.display_name, phone: form.phone, whatsapp: form.whatsapp, email: form.email, gender: form.gender, active: form.active, notes: form.notes };
    const { data, error } = form.id ? await supabase.from("people").update(row).eq("id", form.id).select("id").single() : await supabase.from("people").insert(row).select("id").single();
    if (error || !data) { alert(error?.message); return; }
    await supabase.from("person_services").delete().eq("person_id", data.id);
    if (form.services.length) await supabase.from("person_services").insert(form.services.map((service_id) => ({ person_id: data.id, service_id })));
    await reload(); router.push(`/servidores/${data.id}`);
  }
  if (!personId) {
    const filtered = people.filter((p) => `${p.first_name} ${p.last_name} ${p.display_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(search.toLowerCase()));
    return <><div className="mb-5 flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Servidores</h1>{canEdit && <Link className="button-link primary bg-[#13263d] text-sm text-white hover:bg-[#1d3a5b]" href="/servidores/nuevo"><Plus size={17}/> Nuevo servidor</Link>}</div><input className="mb-4 w-full rounded-lg border bg-white px-3 py-2" placeholder="Buscar servidor" value={search} onChange={(e) => setSearch(e.target.value)} />{filtered.map((p) => <Link key={p.id} href={`/servidores/${p.id}`} className="mb-3 block card-panel p-4 transition hover:border-[#13263d] hover:shadow-md"><b>{p.display_name || `${p.first_name} ${p.last_name}`}</b><p className="text-sm text-slate-500">{p.email || "Sin email"} · {p.active ? "Activo" : "Inactivo"}</p></Link>)}</>;
  }
  return <section className="card-panel p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{personId === "nuevo" ? "Crear servidor" : "Servidor"}</h1>{editing && canEdit && <Link className="button-link border border-slate-300 bg-white text-sm text-slate-700 hover:border-[#13263d] hover:text-[#13263d]" href={`/servidores/${editing.id}/editar`}>Editar</Link>}</div><div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre"><input disabled={!canEdit} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}/></Field><Field label="Apellidos"><input disabled={!canEdit} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}/></Field><Field label="Nombre para mostrar"><input disabled={!canEdit} value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })}/></Field><Field label="Teléfono"><input disabled={!canEdit} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></Field><Field label="WhatsApp"><input disabled={!canEdit} value={form.whatsapp ?? ""} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}/></Field><Field label="Email"><input disabled={!canEdit} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })}/></Field><Field label="Sexo"><select disabled={!canEdit} value={form.gender ?? ""} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="female">Mujer</option><option value="male">Hombre</option><option value="other">Otro</option></select></Field></div><label className="checkbox-field mt-4 text-sm"><input disabled={!canEdit} type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/><span>Activo</span></label><Field label="Notas"><textarea disabled={!canEdit} rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></Field><h2 className="mt-5 font-bold">Servicios autorizados</h2>{categories.map((c) => <div key={c.id} className="mt-3"><p className="text-xs font-black uppercase text-[#b18b4a]">{c.name}</p><div className="service-options">{services.filter((s) => s.category_id === c.id).map((s) => <label key={s.id} className="checkbox-field text-sm"><input disabled={!canEdit} type="checkbox" checked={form.services.includes(s.id)} onChange={(e) => setForm({ ...form, services: e.target.checked ? [...form.services, s.id] : form.services.filter((id) => id !== s.id) })}/><span>{s.name}</span></label>)}</div></div>)}{canEdit && <button onClick={save} className="mt-5 min-h-11 rounded-lg primary bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Guardar</button>}</section>;
}
function ServicesAdmin({ canAdmin, categories, services, reload }: { canAdmin: boolean; categories: Category[]; services: Service[]; reload: () => Promise<void> }) {
  const supabase = createClient();
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, Category>>({});
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, Service>>({});
  const [creating, setCreating] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryOrder, setCategoryOrder] = useState(categories.length + 1);
  async function saveCategory(category: Category, patch: Partial<Category>) { if (supabase && canAdmin) { await supabase.from("service_categories").update(patch).eq("id", category.id); await reload(); } }
  async function addCategory() { const name = categoryName.trim(); if (name && supabase && canAdmin) { await supabase.from("service_categories").insert({ name, display_order: categoryOrder }); setCreating(false); setCategoryName(""); await reload(); } }
  async function addService(category_id: string) { const name = prompt("Nombre del servicio"); if (name && supabase) { await supabase.from("services").insert({ category_id, name, slug: slug(name), stable_key: slug(name), display_order: services.filter((s) => s.category_id === category_id).length + 1 }); await reload(); } }
  async function saveService(service: Service, patch: Partial<Service>) { if (supabase && canAdmin) { await supabase.from("services").update(patch).eq("id", service.id); await reload(); } }
  return <section>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Servicios</h1>{canAdmin && <button onClick={() => setCreating(true)} className="primary"><Plus size={17}/> Crear categoría</button>}</div>
    {creating && <form className="mb-6 border-y border-slate-200 bg-white py-5" onSubmit={(e) => { e.preventDefault(); void addCategory(); }}><h2 className="mb-4 text-lg font-bold">Nueva categoría</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre"><input required value={categoryName} onChange={(e) => setCategoryName(e.target.value)}/></Field><Field label="Orden"><input type="number" required value={categoryOrder} onChange={(e) => setCategoryOrder(Number(e.target.value))}/></Field></div><div className="mt-4 flex flex-wrap gap-2"><button type="submit" className="primary">Crear categoría</button><button type="button" onClick={() => setCreating(false)} className="border bg-white">Cancelar</button></div></form>}
    {categories.map((category) => { const c = categoryDrafts[category.id] ?? category; return <section key={c.id} className="category-section">
      <h2 className="mb-4 text-lg font-bold">Categoría: {c.name}</h2>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]"><Field label="Nombre de categoría"><input disabled={!canAdmin} value={c.name} onChange={(e) => setCategoryDrafts({ ...categoryDrafts, [c.id]: { ...c, name: e.target.value } })}/></Field><Field label="Orden"><input disabled={!canAdmin} type="number" value={c.display_order} onChange={(e) => setCategoryDrafts({ ...categoryDrafts, [c.id]: { ...c, display_order: Number(e.target.value) } })}/></Field></div>
      {canAdmin && <button className="primary mt-4" onClick={() => void saveCategory(c, { name: c.name, display_order: c.display_order })}><Save size={17}/> Guardar categoría</button>}<div className="my-5 flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Servicios de esta categoría</h3>{canAdmin && <button onClick={() => addService(c.id)} className="border bg-white"><Plus size={17}/> Crear servicio</button>}</div>
      <div className="grid gap-4 lg:grid-cols-2">{services.filter((s) => s.category_id === c.id).map((service) => { const s = { ...service, ...serviceDrafts[service.id], active: service.active }; return <article key={s.id} className="service-card"><h4 className="mb-3 font-bold">{s.name}</h4><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px]"><div className="sm:col-span-2"><Field label="Nombre"><input disabled={!canAdmin} value={s.name} onChange={(e) => setServiceDrafts({ ...serviceDrafts, [s.id]: { ...s, name: e.target.value, slug: slug(e.target.value) } })}/></Field></div><Field label="Identificador"><input disabled={!canAdmin} value={s.slug ?? ""} onChange={(e) => setServiceDrafts({ ...serviceDrafts, [s.id]: { ...s, slug: e.target.value } })}/></Field><Field label="Orden"><input disabled={!canAdmin} type="number" value={s.display_order} onChange={(e) => setServiceDrafts({ ...serviceDrafts, [s.id]: { ...s, display_order: Number(e.target.value) } })}/></Field></div><label className="checkbox-field mt-2 text-sm"><input disabled={!canAdmin} type="checkbox" checked={s.allow_multiple_people} onChange={(e) => setServiceDrafts({ ...serviceDrafts, [s.id]: { ...s, allow_multiple_people: e.target.checked } })}/><span>Permite múltiples</span></label>{canAdmin && <div className="flex flex-wrap gap-2"><button className="primary mt-2" onClick={() => void saveService(s, { name: s.name, slug: s.slug, display_order: s.display_order, allow_multiple_people: s.allow_multiple_people })}><Save size={17}/> Guardar</button><button onClick={() => void saveService(s, { active: !s.active })} className="mt-2 border bg-white">{s.active ? "Desactivar" : "Activar"}</button></div>}</article>; })}</div>
    </section>; })}
  </section>;
}
function TimesAdmin({ canAdmin, massTimes, reload }: { canAdmin: boolean; massTimes: MassTime[]; reload: () => Promise<void> }) {
  const supabase = createClient();
  async function addTime() { const name = prompt("Etiqueta, ej. 12:00 PM"); const time = prompt("Hora 24h, ej. 12:00"); if (name && time && supabase) { await supabase.from("mass_times").insert({ parish_id: parishId, name, time, display_order: massTimes.length + 1 }); await reload(); } }
  async function saveTime(t: MassTime, patch: Partial<MassTime>) { if (supabase && canAdmin) { await supabase.from("mass_times").update(patch).eq("id", t.id); await reload(); } }
  return <section className="card-panel p-5"><div className="mb-4 flex justify-between"><h1 className="text-2xl font-bold">Horarios</h1>{canAdmin && <button onClick={addTime} className="min-h-11 rounded-lg primary bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Crear horario</button>}</div>{massTimes.map((t) => <div key={t.id} className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[1fr_120px_110px_120px]"><input disabled={!canAdmin} value={t.name} onChange={(e) => void saveTime(t, { name: e.target.value })}/><input disabled={!canAdmin} type="time" value={t.time.slice(0,5)} onChange={(e) => void saveTime(t, { time: e.target.value } as Partial<MassTime>)}/><input disabled={!canAdmin} type="number" value={t.display_order} onChange={(e) => void saveTime(t, { display_order: Number(e.target.value) })}/>{canAdmin && <button onClick={() => void saveTime(t, { active: !t.active })} className="rounded border px-3 py-1 text-sm">{t.active ? "Desactivar" : "Activar"}</button>}</div>)}</section>;
}
function ParishAdmin({ canAdmin, parish, reload }: { canAdmin: boolean; parish: Parish; reload: () => Promise<void> }) {
  const supabase = createClient();
  const [form, setForm] = useState(parish);
  async function upload(kind: "logo_url" | "patron_image_url", file: File | null) {
    if (!file || !supabase || !canAdmin) return;
    const path = `${parish.id}/${kind}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("parish-assets").upload(path, file, { upsert: true });
    if (error) { alert(error.message); return; }
    const { data } = supabase.storage.from("parish-assets").getPublicUrl(path);
    setForm({ ...form, [kind]: data.publicUrl });
  }
  async function save() { if (supabase && canAdmin) { await supabase.from("parishes").update(form).eq("id", parish.id); await reload(); } }
  return <section className="card-panel p-5"><h1 className="mb-4 text-2xl font-bold">Parroquia</h1><div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre"><input disabled={!canAdmin} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></Field><Field label="Teléfono"><input disabled={!canAdmin} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></Field><Field label="Logo"><input disabled={!canAdmin} type="file" accept="image/*" onChange={(e) => void upload("logo_url", e.target.files?.[0] ?? null)}/><input disabled={!canAdmin} value={form.logo_url ?? ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })}/></Field><Field label="Imagen del santo patrono"><input disabled={!canAdmin} type="file" accept="image/*" onChange={(e) => void upload("patron_image_url", e.target.files?.[0] ?? null)}/><input disabled={!canAdmin} value={form.patron_image_url ?? ""} onChange={(e) => setForm({ ...form, patron_image_url: e.target.value })}/></Field></div><Field label="Dirección"><input disabled={!canAdmin} value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })}/></Field>{canAdmin && <button onClick={save} className="mt-5 min-h-11 rounded-lg primary bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Guardar</button>}</section>;
}
function SettingsAdmin({ canAdmin, settings, reload }: { canAdmin: boolean; settings: SettingsRow; reload: () => Promise<void> }) { const supabase = createClient(); const [form, setForm] = useState(settings); async function save() { if (supabase && canAdmin) { await supabase.from("parish_settings").upsert({ parish_id: parishId, ...form }, { onConflict: "parish_id" }); await reload(); } } return <section className="card-panel p-5"><h1 className="mb-4 text-2xl font-bold">Configuración</h1>{(["women_clothing", "men_clothing", "general_clothing", "default_notes"] as const).map((key) => <Field key={key} label={key}><textarea disabled={!canAdmin} rows={2} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })}/></Field>)}<label className="checkbox-field mt-4 text-sm"><input disabled={!canAdmin} type="checkbox" checked={form.allow_multiple_services} onChange={(e) => setForm({ ...form, allow_multiple_services: e.target.checked })}/><span>Permitir múltiples servicios</span></label>{canAdmin && <button onClick={save} className="mt-5 rounded-lg primary bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Guardar</button>}</section>; }
function slug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
