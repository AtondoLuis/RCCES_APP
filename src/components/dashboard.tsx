"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { CalendarDays, Copy, Download, Image as ImageIcon, LogOut, Plus, Save, Search, Send, Settings, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Role = "ADMIN" | "COORDINADOR" | "LECTOR";
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
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState("Cambios pendientes");
  const canEdit = role === "ADMIN" || role === "COORDINADOR";
  const canAdmin = role === "ADMIN";
  const massId = pathname.match(/^\/comisiones\/([^/]+)/)?.[1];
  const personId = pathname.match(/^\/servidores\/([^/]+)/)?.[1];

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => {
    if (massId && massId !== "nueva" && massId !== mass.id) void loadMass(massId);
    if (pathname === "/comisiones/nueva") { window.setTimeout(() => { setMass(emptyMass(massTimes[0]?.id ?? "")); setAssignments({}); }, 0); }
  }, [massId, pathname, massTimes]);

  async function loadAll() {
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
    if (!mass.mass_time_id) setMass(emptyMass(timesRes.data?.[0]?.id ?? ""));
    setLoading(false);
  }

  async function loadMass(id: string) {
    if (!supabase) return;
    setLoading(true);
    const [massRes, assignRes] = await Promise.all([supabase.from("masses").select("*").eq("id", id).single(), supabase.from("mass_assignments").select("service_id, person_id, display_order").eq("mass_id", id).order("display_order")]);
    if (massRes.error || assignRes.error) setError(massRes.error?.message || assignRes.error?.message || "Error al cargar comisión");
    if (massRes.data) setMass(massRes.data as Mass);
    const next: AssignmentMap = {};
    assignRes.data?.forEach((row) => { next[row.service_id] = [...(next[row.service_id] ?? []), row.person_id]; });
    setAssignments(next); setLoading(false);
  }

  async function saveMass() {
    if (!supabase || !canEdit) return;
    setSaved("Guardando...");
    const payload = { mass_id: mass.id ?? null, parish_id: parish.id, mass_date: mass.mass_date, mass_time_id: mass.mass_time_id, title: mass.title, subtitle: mass.subtitle, liturgical_cycle: mass.liturgical_cycle, status: mass.status, liturgical_text_title: mass.liturgical_text_title, liturgical_text: mass.liturgical_text, liturgical_text_reference: mass.liturgical_text_reference, image_url: mass.image_url, notes: mass.notes, assignments: Object.entries(assignments).flatMap(([service_id, ids]) => ids.filter(Boolean).map((person_id, display_order) => ({ service_id, person_id, display_order }))) };
    const { data, error: rpcError } = await supabase.rpc("save_mass_with_assignments", payload);
    if (rpcError) { setSaved("Error al guardar"); setError(`No se pudo guardar la comisión completa: ${rpcError.message}`); return; }
    setSaved("Guardado en Supabase"); await loadAll(); router.push(`/comisiones/${String(data)}/editar`);
  }

  function label(person?: Person) { return person ? person.display_name || `${person.first_name} ${person.last_name}`.trim() : "Sin asignar"; }
  function peopleFor(service: Service) {
    const assigned = new Set(Object.values(assignments).flat());
    return people.filter((p) => p.active && p.services.includes(service.id) && label(p).toLowerCase().includes(query.toLowerCase())).map((p) => { const av = availability.find((a) => a.person_id === p.id && a.mass_date === mass.mass_date && a.mass_time_id === mass.mass_time_id); const state = assigned.has(p.id) ? "Ya asignado" : av?.status === "unavailable" ? "No disponible" : av?.status === "pending" ? "Pendiente" : "Disponible"; return { ...p, state }; });
  }
  function changeAssignment(service: Service, index: number, value: string) { const picked = peopleFor(service).find((p) => p.id === value); if (picked?.state === "No disponible" && !window.confirm("Esta persona está marcada como No disponible. ¿Deseas asignarla de todos modos?")) return; const current = assignments[service.id] ?? []; const next = [...current]; next[index] = value; setAssignments({ ...assignments, [service.id]: next.filter(Boolean) }); setSaved("Cambios pendientes"); }
  async function exportPng(downloadOnly = false) {
    if (!previewRef.current) return null;
    const dataUrl = await toPng(previewRef.current, { pixelRatio: 2, backgroundColor: "#ffffff", width: 1080, canvasWidth: 1080 });
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
    {pathname.startsWith("/comisiones") && <Commissions path={pathname} masses={masses} mass={mass} setMass={setMass} massTimes={massTimes} services={services} categories={categories} assignments={assignments} setAssignments={setAssignments} peopleFor={peopleFor} personName={(id) => label(people.find((p) => p.id === id))} query={query} setQuery={setQuery} canEdit={canEdit} saved={saved} onSave={saveMass} onDuplicate={() => { setMass({ ...mass, id: undefined, mass_date: "2026-10-13" }); router.push("/comisiones/nueva"); }} onChange={changeAssignment} previewRef={previewRef} parish={parish} settings={settings} onDownload={() => void exportPng(true)} onShare={() => void shareImage()} />}
    {pathname.startsWith("/servidores") && <PeopleView canEdit={canEdit} personId={personId} people={people} services={services} categories={categories} reload={loadAll} />}
    {pathname === "/admin/servicios" && <ServicesAdmin canAdmin={canAdmin} categories={categories} services={services} reload={loadAll} />}
    {pathname === "/admin/horarios" && <TimesAdmin canAdmin={canAdmin} massTimes={massTimes} reload={loadAll} />}
    {pathname === "/admin/parroquia" && <ParishAdmin canAdmin={canAdmin} parish={parish} reload={loadAll} />}
    {pathname === "/admin/configuracion" && <SettingsAdmin canAdmin={canAdmin} settings={settings} reload={loadAll} />}
  </Shell>;
}

function Shell({ children, role, onLogout }: { children: React.ReactNode; role: Role; onLogout?: () => void }) {
  const nav = [["/comisiones", "Comisiones"], ["/servidores", "Servidores"], ["/admin/servicios", "Servicios"], ["/admin/horarios", "Horarios"], ["/admin/parroquia", "Parroquia"], ["/admin/configuracion", "Configuración"]];
  return <div className="min-h-screen bg-[#f7f8fa] text-slate-900"><header className="sticky top-0 z-20 border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8"><Link href="/" className="font-serif text-xl font-bold text-[#13263d]">Santo Toribio Romo</Link><nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-600">{nav.map(([href, name]) => <Link key={href} href={href} className="rounded-lg px-2 py-1 hover:bg-slate-100">{name}</Link>)}<span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">{role}</span>{onLogout && <button onClick={onLogout} className="rounded-lg p-2" aria-label="Salir"><LogOut size={17}/></button>}</nav></div></header><main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8">{children}</main></div>;
}
function State({ text }: { text: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">{text}</div>; }
function formatDate(date: string) { return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function timeName(times: MassTime[], id: string) { return times.find((t) => t.id === id)?.name ?? "Sin hora"; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>{children}</label>; }
function Home({ masses, people, services, massTimes }: { masses: Mass[]; people: Person[]; services: Service[]; massTimes: MassTime[] }) { return <><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-wide text-[#b18b4a]">Panel de coordinación</p><h1 className="text-3xl font-bold text-[#13263d]">Comisiones para la Santa Misa</h1></div><Link className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#13263d] px-4 text-sm font-bold text-white" href="/comisiones/nueva"><Plus size={17}/> Nueva comisión</Link></div><div className="grid gap-4 md:grid-cols-3"><Stat label="Comisiones" value={String(masses.length)} icon={<CalendarDays/>}/><Stat label="Servidores" value={String(people.length)} icon={<Users/>}/><Stat label="Servicios" value={String(services.length)} icon={<Settings/>}/></div><section className="mt-7 rounded-lg border bg-white p-5"><h2 className="mb-4 text-lg font-bold">Próximas comisiones</h2>{masses.length ? masses.map((m) => <Link key={m.id} href={`/comisiones/${m.id}`} className="flex justify-between border-t py-3 text-sm"><span>{m.title}</span><span>{formatDate(m.mass_date)} · {timeName(massTimes, m.mass_time_id)}</span></Link>) : <State text="No hay datos" />}</section></>; }
function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) { return <div className="flex items-center gap-4 rounded-lg border bg-white p-5"><span className="text-[#13263d]">{icon}</span><div><p className="text-xs uppercase text-slate-500">{label}</p><p className="text-2xl font-black text-[#13263d]">{value}</p></div></div>; }

function Commissions(props: { path: string; masses: Mass[]; mass: Mass; setMass: (m: Mass) => void; massTimes: MassTime[]; services: Service[]; categories: Category[]; assignments: AssignmentMap; setAssignments: (a: AssignmentMap) => void; peopleFor: (s: Service) => Array<Person & { state: string }>; personName: (id: string) => string; query: string; setQuery: (q: string) => void; canEdit: boolean; saved: string; onSave: () => void; onDuplicate: () => void; onChange: (s: Service, i: number, p: string) => void; previewRef: React.RefObject<HTMLDivElement | null>; parish: Parish; settings: SettingsRow; onDownload: () => void; onShare: () => void }) {
  const [dateFilter, setDateFilter] = useState("");
  const [timeFilter, setTimeFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  if (props.path === "/comisiones") {
    const filtered = props.masses.filter((m) => (!dateFilter || m.mass_date === dateFilter) && (!timeFilter || m.mass_time_id === timeFilter) && (!statusFilter || m.status === statusFilter) && (!personFilter || m.title.toLowerCase().includes(personFilter.toLowerCase())));
    return <><div className="mb-5 flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Comisiones</h1>{props.canEdit && <Link className="rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white" href="/comisiones/nueva">Nueva</Link>}</div><div className="mb-5 grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-4"><input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /><select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}><option value="">Todos los horarios</option>{props.massTimes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><input placeholder="Persona o celebración" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} /><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">Todos los estados</option><option value="draft">Borrador</option><option value="published">Publicado</option><option value="finished">Finalizado</option><option value="cancelled">Cancelado</option></select></div>{filtered.length ? filtered.map((m) => <Link key={m.id} href={`/comisiones/${m.id}`} className="mb-3 grid gap-2 rounded-lg border bg-white p-4 text-sm md:grid-cols-4"><b>{formatDate(m.mass_date)}</b><span>{timeName(props.massTimes, m.mass_time_id)}</span><span>{m.title}</span><span>{m.status}</span></Link>) : <State text="No hay datos" />}</>;
  }
  const previewOnly = props.path.endsWith("/preview") || /^\/comisiones\/[^/]+$/.test(props.path);
  return <div className="grid gap-7 xl:grid-cols-[minmax(0,0.9fr)_minmax(500px,1.1fr)]">{!previewOnly && <section className="rounded-lg border bg-white p-5"><div className="mb-4 flex items-center justify-between"><h1 className="text-xl font-bold">{props.mass.id ? "Editar comisión" : "Nueva comisión"}</h1><span className="text-sm text-slate-500">{props.saved}</span></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Fecha"><input disabled={!props.canEdit} type="date" value={props.mass.mass_date} onChange={(e) => props.setMass({ ...props.mass, mass_date: e.target.value })}/></Field><Field label="Hora"><select disabled={!props.canEdit} value={props.mass.mass_time_id} onChange={(e) => props.setMass({ ...props.mass, mass_time_id: e.target.value })}>{props.massTimes.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Celebración"><input disabled={!props.canEdit} value={props.mass.title} onChange={(e) => props.setMass({ ...props.mass, title: e.target.value })}/></Field><Field label="Subtítulo"><input disabled={!props.canEdit} value={props.mass.subtitle ?? ""} onChange={(e) => props.setMass({ ...props.mass, subtitle: e.target.value })}/></Field><Field label="Ciclo litúrgico"><input disabled={!props.canEdit} value={props.mass.liturgical_cycle ?? ""} onChange={(e) => props.setMass({ ...props.mass, liturgical_cycle: e.target.value })}/></Field><Field label="Estado"><select disabled={!props.canEdit} value={props.mass.status} onChange={(e) => props.setMass({ ...props.mass, status: e.target.value })}><option value="draft">Borrador</option><option value="published">Publicado</option><option value="finished">Finalizado</option><option value="cancelled">Cancelado</option></select></Field><Field label="Título texto litúrgico"><input disabled={!props.canEdit} value={props.mass.liturgical_text_title ?? ""} onChange={(e) => props.setMass({ ...props.mass, liturgical_text_title: e.target.value })}/></Field><Field label="Referencia"><input disabled={!props.canEdit} value={props.mass.liturgical_text_reference ?? ""} onChange={(e) => props.setMass({ ...props.mass, liturgical_text_reference: e.target.value })}/></Field></div><Field label="Texto litúrgico"><textarea disabled={!props.canEdit} rows={3} value={props.mass.liturgical_text ?? ""} onChange={(e) => props.setMass({ ...props.mass, liturgical_text: e.target.value })}/></Field><div className="relative my-5"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input className="w-full rounded-lg border bg-slate-50 py-2.5 pl-10" placeholder="Buscar servidor..." value={props.query} onChange={(e) => props.setQuery(e.target.value)}/></div>{props.categories.map((cat) => <div key={cat.id} className="mb-5"><h2 className="mb-2 text-xs font-black uppercase tracking-wide text-[#b18b4a]">{cat.name}</h2>{props.services.filter((s) => s.active && s.category_id === cat.id).map((s) => <div key={s.id} className="mb-3 rounded-lg border bg-slate-50 p-3"><div className="mb-2 flex justify-between"><b>{s.name}</b>{(s.allow_multiple_people || props.settings.allow_multiple_services) && props.canEdit && <button onClick={() => props.setAssignments({ ...props.assignments, [s.id]: [...(props.assignments[s.id] ?? []), ""] })} className="text-sm font-bold text-[#13263d]">Agregar</button>}</div>{Array.from({ length: Math.max(1, props.assignments[s.id]?.length ?? 0) }).map((_, i) => <select key={`${s.id}-${i}`} disabled={!props.canEdit} className="mb-2 w-full rounded-lg border bg-white p-2" value={props.assignments[s.id]?.[i] ?? ""} onChange={(e) => props.onChange(s, i, e.target.value)}><option value="">No disponible / sin asignar</option>{props.peopleFor(s).map((p) => <option key={p.id} value={p.id}>{p.display_name || `${p.first_name} ${p.last_name}`} - {p.state}</option>)}</select>)}</div>)}</div>)}<Field label="Notas"><textarea disabled={!props.canEdit} rows={3} value={props.mass.notes ?? ""} onChange={(e) => props.setMass({ ...props.mass, notes: e.target.value })}/></Field>{props.canEdit && <div className="mt-5 flex flex-wrap gap-2"><button onClick={props.onSave} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#13263d] px-4 text-sm font-bold text-white"><Save size={17}/> Guardar</button><button onClick={props.onDuplicate} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-bold"><Copy size={17}/> Duplicar</button></div>}</section>}<WhatsAppScheduleImage {...props} /></div>;
}
function WhatsAppScheduleImage({ previewRef, parish, mass, massTimes, categories, services, assignments, personName, settings, onDownload, onShare }: { previewRef: React.RefObject<HTMLDivElement | null>; parish: Parish; mass: Mass; massTimes: MassTime[]; categories: Category[]; services: Service[]; assignments: AssignmentMap; personName: (id: string) => string; settings: SettingsRow; onDownload: () => void; onShare: () => void }) { return <section><div ref={previewRef} className="mx-auto w-full max-w-[1080px] bg-white p-8 text-slate-900 shadow-sm"><p className="text-center text-sm font-black uppercase tracking-[0.22em] text-[#b18b4a]">Comisiones para la Santa Misa</p><h1 className="mt-2 text-center text-3xl font-black text-[#13263d]">{parish.name}</h1><p className="mt-5 text-center text-xl font-bold">{mass.title}</p><p className="text-center text-slate-500">{mass.subtitle}</p><div className="my-5 flex justify-center gap-5 border-y py-3 text-lg font-bold"><span>{formatDate(mass.mass_date)}</span><span>{timeName(massTimes, mass.mass_time_id)}</span></div><div className="grid gap-4 sm:grid-cols-2">{categories.map((cat) => <div key={cat.id} className="rounded-lg bg-slate-50 p-4"><h2 className="mb-3 text-sm font-black uppercase text-[#b18b4a]">{cat.name}</h2>{services.filter((s) => s.active && s.category_id === cat.id).map((s) => <p key={s.id} className="mb-2 text-sm"><b>{s.name}:</b> {(assignments[s.id] ?? []).map(personName).join(" · ") || "Pendiente"}</p>)}</div>)}</div><div className="mt-5 border-t pt-4 text-sm leading-6"><b>Vestimenta</b><p>Mujeres: {settings.women_clothing || "No configurado"} · Hombres: {settings.men_clothing || "No configurado"} · General: {settings.general_clothing || "No configurado"}</p><p className="mt-2"><b>Notas:</b> {mass.notes || settings.default_notes || "Sin notas"}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={onDownload} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#13263d] px-4 text-sm font-bold text-white"><ImageIcon size={17}/> Generar PNG</button><button onClick={onShare} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-bold"><Send size={17}/> Compartir</button><button onClick={onDownload} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-bold"><Download size={17}/> Descargar</button></div></section>; }

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
    return <><div className="mb-5 flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Servidores</h1>{canEdit && <Link className="rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white" href="/servidores/nuevo">Nuevo</Link>}</div><input className="mb-4 w-full rounded-lg border bg-white px-3 py-2" placeholder="Buscar servidor" value={search} onChange={(e) => setSearch(e.target.value)} />{filtered.map((p) => <Link key={p.id} href={`/servidores/${p.id}`} className="mb-3 block rounded-lg border bg-white p-4"><b>{p.display_name || `${p.first_name} ${p.last_name}`}</b><p className="text-sm text-slate-500">{p.email || "Sin email"} · {p.active ? "Activo" : "Inactivo"}</p></Link>)}</>;
  }
  return <section className="rounded-lg border bg-white p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{personId === "nuevo" ? "Crear servidor" : "Servidor"}</h1>{editing && canEdit && <Link className="rounded border px-3 py-2 text-sm font-bold" href={`/servidores/${editing.id}/editar`}>Editar</Link>}</div><div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre"><input disabled={!canEdit} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}/></Field><Field label="Apellidos"><input disabled={!canEdit} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}/></Field><Field label="Nombre para mostrar"><input disabled={!canEdit} value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })}/></Field><Field label="Teléfono"><input disabled={!canEdit} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></Field><Field label="WhatsApp"><input disabled={!canEdit} value={form.whatsapp ?? ""} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}/></Field><Field label="Email"><input disabled={!canEdit} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })}/></Field><Field label="Sexo"><select disabled={!canEdit} value={form.gender ?? ""} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="female">Mujer</option><option value="male">Hombre</option><option value="other">Otro</option></select></Field></div><label className="mt-4 flex gap-2"><input disabled={!canEdit} type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> Activo</label><Field label="Notas"><textarea disabled={!canEdit} rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></Field><h2 className="mt-5 font-bold">Servicios autorizados</h2>{categories.map((c) => <div key={c.id} className="mt-3"><p className="text-xs font-black uppercase text-[#b18b4a]">{c.name}</p>{services.filter((s) => s.category_id === c.id).map((s) => <label key={s.id} className="mr-4 inline-flex gap-2 py-1 text-sm"><input disabled={!canEdit} type="checkbox" checked={form.services.includes(s.id)} onChange={(e) => setForm({ ...form, services: e.target.checked ? [...form.services, s.id] : form.services.filter((id) => id !== s.id) })}/>{s.name}</label>)}</div>)}{canEdit && <button onClick={save} className="mt-5 min-h-11 rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Guardar</button>}</section>;
}
function ServicesAdmin({ canAdmin, categories, services, reload }: { canAdmin: boolean; categories: Category[]; services: Service[]; reload: () => Promise<void> }) {
  const supabase = createClient();
  async function saveCategory(category: Category, patch: Partial<Category>) { if (supabase && canAdmin) { await supabase.from("service_categories").update(patch).eq("id", category.id); await reload(); } }
  async function addCategory() { const name = prompt("Nombre de categoría"); if (name && supabase) { await supabase.from("service_categories").insert({ name, display_order: categories.length + 1 }); await reload(); } }
  async function addService(category_id: string) { const name = prompt("Nombre del servicio"); if (name && supabase) { await supabase.from("services").insert({ category_id, name, slug: slug(name), stable_key: slug(name), display_order: services.filter((s) => s.category_id === category_id).length + 1 }); await reload(); } }
  async function saveService(service: Service, patch: Partial<Service>) { if (supabase && canAdmin) { await supabase.from("services").update(patch).eq("id", service.id); await reload(); } }
  return <section className="rounded-lg border bg-white p-5"><div className="mb-4 flex justify-between"><h1 className="text-2xl font-bold">Servicios</h1>{canAdmin && <button onClick={addCategory} className="min-h-11 rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Crear categoría</button>}</div>{categories.map((c) => <div key={c.id} className="mb-5 border-t pt-4"><div className="grid gap-2 md:grid-cols-[1fr_110px_auto]"><input disabled={!canAdmin} value={c.name} onChange={(e) => void saveCategory(c, { name: e.target.value })}/><input disabled={!canAdmin} type="number" value={c.display_order} onChange={(e) => void saveCategory(c, { display_order: Number(e.target.value) })}/>{canAdmin && <button onClick={() => addService(c.id)} className="rounded border px-3 py-2 text-sm font-bold">Crear servicio</button>}</div>{services.filter((s) => s.category_id === c.id).map((s) => <div key={s.id} className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[1fr_120px_110px_130px_120px]"><input disabled={!canAdmin} value={s.name} onChange={(e) => void saveService(s, { name: e.target.value, slug: slug(e.target.value) })}/><input disabled={!canAdmin} value={s.slug ?? ""} onChange={(e) => void saveService(s, { slug: e.target.value })}/><input disabled={!canAdmin} type="number" value={s.display_order} onChange={(e) => void saveService(s, { display_order: Number(e.target.value) })}/><label className="flex items-center gap-2 text-sm"><input disabled={!canAdmin} type="checkbox" checked={s.allow_multiple_people} onChange={(e) => void saveService(s, { allow_multiple_people: e.target.checked })}/> Múltiples</label>{canAdmin && <button onClick={() => void saveService(s, { active: !s.active })} className="rounded border px-3 py-1 text-sm">{s.active ? "Desactivar" : "Activar"}</button>}</div>)}</div>)}</section>;
}
function TimesAdmin({ canAdmin, massTimes, reload }: { canAdmin: boolean; massTimes: MassTime[]; reload: () => Promise<void> }) {
  const supabase = createClient();
  async function addTime() { const name = prompt("Etiqueta, ej. 12:00 PM"); const time = prompt("Hora 24h, ej. 12:00"); if (name && time && supabase) { await supabase.from("mass_times").insert({ parish_id: parishId, name, time, display_order: massTimes.length + 1 }); await reload(); } }
  async function saveTime(t: MassTime, patch: Partial<MassTime>) { if (supabase && canAdmin) { await supabase.from("mass_times").update(patch).eq("id", t.id); await reload(); } }
  return <section className="rounded-lg border bg-white p-5"><div className="mb-4 flex justify-between"><h1 className="text-2xl font-bold">Horarios</h1>{canAdmin && <button onClick={addTime} className="min-h-11 rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Crear horario</button>}</div>{massTimes.map((t) => <div key={t.id} className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[1fr_120px_110px_120px]"><input disabled={!canAdmin} value={t.name} onChange={(e) => void saveTime(t, { name: e.target.value })}/><input disabled={!canAdmin} type="time" value={t.time.slice(0,5)} onChange={(e) => void saveTime(t, { time: e.target.value } as Partial<MassTime>)}/><input disabled={!canAdmin} type="number" value={t.display_order} onChange={(e) => void saveTime(t, { display_order: Number(e.target.value) })}/>{canAdmin && <button onClick={() => void saveTime(t, { active: !t.active })} className="rounded border px-3 py-1 text-sm">{t.active ? "Desactivar" : "Activar"}</button>}</div>)}</section>;
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
  return <section className="rounded-lg border bg-white p-5"><h1 className="mb-4 text-2xl font-bold">Parroquia</h1><div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre"><input disabled={!canAdmin} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></Field><Field label="Teléfono"><input disabled={!canAdmin} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></Field><Field label="Logo"><input disabled={!canAdmin} type="file" accept="image/*" onChange={(e) => void upload("logo_url", e.target.files?.[0] ?? null)}/><input disabled={!canAdmin} value={form.logo_url ?? ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })}/></Field><Field label="Imagen del santo patrono"><input disabled={!canAdmin} type="file" accept="image/*" onChange={(e) => void upload("patron_image_url", e.target.files?.[0] ?? null)}/><input disabled={!canAdmin} value={form.patron_image_url ?? ""} onChange={(e) => setForm({ ...form, patron_image_url: e.target.value })}/></Field></div><Field label="Dirección"><input disabled={!canAdmin} value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })}/></Field>{canAdmin && <button onClick={save} className="mt-5 min-h-11 rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Guardar</button>}</section>;
}
function SettingsAdmin({ canAdmin, settings, reload }: { canAdmin: boolean; settings: SettingsRow; reload: () => Promise<void> }) { const supabase = createClient(); const [form, setForm] = useState(settings); async function save() { if (supabase && canAdmin) { await supabase.from("parish_settings").upsert({ parish_id: parishId, ...form }, { onConflict: "parish_id" }); await reload(); } } return <section className="rounded-lg border bg-white p-5"><h1 className="mb-4 text-2xl font-bold">Configuración</h1>{(["women_clothing", "men_clothing", "general_clothing", "default_notes"] as const).map((key) => <Field key={key} label={key}><textarea disabled={!canAdmin} rows={2} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })}/></Field>)}<label className="mt-4 flex gap-2"><input disabled={!canAdmin} type="checkbox" checked={form.allow_multiple_services} onChange={(e) => setForm({ ...form, allow_multiple_services: e.target.checked })}/> Permitir múltiples servicios</label>{canAdmin && <button onClick={save} className="mt-5 rounded-lg bg-[#13263d] px-4 py-2 text-sm font-bold text-white">Guardar</button>}</section>; }
function slug(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }









