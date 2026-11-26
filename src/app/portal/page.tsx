"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/module-shell"; import { PhoneLinkForm } from "@/components/auth/phone-link-form";
import { SERVER_CLASSES, serverClassLabel } from "@/lib/server-classes";
import { isCategoryVisible, isServiceVisible, previewVisibility, type PreviewVisibility } from "@/lib/preview-visibility";
import { createClient } from "@/lib/supabase/client";

type Profile = { id: string; full_name: string | null; email: string | null; phone_contact: string | null; phone_verified_at: string | null; person_id: string | null };
type Person = { id: string; parish_id: string; first_name: string; last_name: string; display_name: string | null; class_id: string | null; gender: string | null; email: string | null; phone: string | null; birth_day: number | null; birth_month: number | null };
type BirthdayPerson = { id: string; first_name: string; last_name: string; display_name: string | null; birth_day: number; birth_month: number };
type Assignment = { mass_id: string; service_id: string; services: { id: string; name: string; category_id: string; active: boolean } | { id: string; name: string; category_id: string; active: boolean }[] | null };
type Commission = { id: string; mass_date: string; mass_time_id: string; title: string; subtitle: string | null; preview_visibility: PreviewVisibility | null };
type MassTime = { id: string; name: string; time: string };
type Notice = { id: string; title: string; description: string; published_at: string; expires_at: string | null; priority: string; activity_id: string | null; announcement_reads: { read_at: string }[] };
type ActivityParticipant = { activity_id: string; community_activities: { id: string; name: string; activity_date: string; start_time: string; status: string } | { id: string; name: string; activity_date: string; start_time: string; status: string }[] | null };
type Attendance = { activity_id: string; status: "pending" | "present" | "absent" };
type FundraisingParticipant = { event_id: string; required_amount: number; fundraising_events: { id: string; name: string; status: string; deadline: string | null } | { id: string; name: string; status: string; deadline: string | null }[] | null };
type Payment = { event_id: string; amount: number; paid_at: string; status: string };
type PortalData = { profile: Profile; person: Person; commissions: Commission[]; times: MassTime[]; assignments: Assignment[]; notices: Notice[]; activities: ActivityParticipant[]; attendance: Attendance[]; fundraising: FundraisingParticipant[]; payments: Payment[]; birthdays: BirthdayPerson[] };

const todayInTijuana = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const timeInTijuana = () => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Tijuana", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);

export default function PortalPage() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<PortalData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError("Supabase no está configurado."); setBusy(false); return; }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { setError(authError?.message ?? "No se pudo verificar la sesión."); setBusy(false); return; }
      const profileResult = await supabase.from("profiles").select("id,full_name,email,phone_contact,phone_verified_at,person_id").eq("id", auth.user.id).maybeSingle();
      if (profileResult.error || !profileResult.data?.person_id) {
        setError(profileResult.error?.message ?? "Tu cuenta aún no está vinculada a un servidor. Solicita apoyo a Administración.");
        setBusy(false);
        return;
      }
      const profile = profileResult.data as Profile;
      const personResult = await supabase.from("people").select("id,parish_id,first_name,last_name,display_name,class_id,gender,email,phone,birth_day,birth_month").eq("id", profile.person_id).maybeSingle();
      if (personResult.error || !personResult.data) {
        setError(personResult.error?.message ?? "No se encontró tu perfil de servidor vinculado.");
        setBusy(false);
        return;
      }
      const person = personResult.data as Person;
      const [assignmentResult, noticeResult, activityResult, attendanceResult, participantResult, paymentResult, birthdayResult] = await Promise.all([
        supabase.from("mass_assignments").select("mass_id,service_id,services(id,name,category_id,active)").eq("person_id", person.id),
        supabase.from("announcements").select("id,title,description,published_at,expires_at,priority,activity_id,announcement_reads(read_at)").eq("status", "published").order("published_at", { ascending: false }),
        supabase.from("activity_participants").select("activity_id,community_activities(id,name,activity_date,start_time,status)").eq("server_id", person.id),
        supabase.from("attendance_records").select("activity_id,status").eq("server_id", person.id),
        supabase.from("fundraising_participants").select("event_id,required_amount,fundraising_events(id,name,status,deadline)").eq("server_id", person.id),
        supabase.from("fundraising_payments").select("event_id,amount,paid_at,status").eq("server_id", person.id).order("paid_at", { ascending: false }),
        supabase.from("people").select("id,first_name,last_name,display_name,birth_day,birth_month").eq("parish_id", person.parish_id).eq("active", true).not("birth_day", "is", null).not("birth_month", "is", null).order("birth_month").order("birth_day"),
      ]);
      const failed = [assignmentResult, noticeResult, activityResult, attendanceResult, participantResult, paymentResult, birthdayResult].find((result) => result.error);
      if (failed?.error) { setError(failed.error.message); setBusy(false); return; }
      const assignments = (assignmentResult.data ?? []) as Assignment[];
      const massIds = [...new Set(assignments.map((item) => item.mass_id))];
      const visibleCommissionIds = massIds.length
        ? await supabase.from("masses").select("id,mass_date,mass_time_id,title,subtitle,preview_visibility").in("id", massIds).eq("status", "published").gte("mass_date", todayInTijuana()).order("mass_date")
        : { data: [], error: null };
      if (visibleCommissionIds.error) { setError(visibleCommissionIds.error.message); setBusy(false); return; }
      const commissions = (visibleCommissionIds.data ?? []) as Commission[];
      const timeIds = [...new Set(commissions.map((mass) => mass.mass_time_id).filter(Boolean))];
      const timesResult = timeIds.length ? await supabase.from("mass_times").select("id,name,time").in("id", timeIds) : { data: [], error: null };
      if (timesResult.error) { setError(timesResult.error.message); setBusy(false); return; }
      if (!active) return;
      setData({
        profile, person, commissions, times: (timesResult.data ?? []) as MassTime[], assignments,
        notices: (noticeResult.data ?? []) as Notice[], activities: (activityResult.data ?? []) as ActivityParticipant[],
        attendance: (attendanceResult.data ?? []) as Attendance[], fundraising: (participantResult.data ?? []) as FundraisingParticipant[],
        payments: (paymentResult.data ?? []) as Payment[], birthdays: (birthdayResult.data ?? []) as BirthdayPerson[],
      });
      setBusy(false);
    }
    void load();
    return () => { active = false; };
  }, [supabase]);

  async function markAsRead(noticeId: string) {
    if (!supabase || !data) return;
    const result = await supabase.from("announcement_reads").upsert(
      { announcement_id: noticeId, profile_id: data.profile.id, read_at: new Date().toISOString() },
      { onConflict: "announcement_id,profile_id" },
    );
    if (result.error) setError(result.error.message);
    else {
      setError("");
      setSaved("Aviso marcado como leído.");
      setData((current) => current ? { ...current, notices: current.notices.map((notice) => notice.id === noticeId
        ? { ...notice, announcement_reads: [{ read_at: new Date().toISOString() }] } : notice) } : current);
    }
  }

  if (busy) return <ModuleShell><p role="status" className="card-panel p-6">Cargando tu portal...</p></ModuleShell>;
  if (!data) return <ModuleShell><section className="card-panel p-6"><h1 className="mb-3 text-2xl font-bold">Portal del servidor</h1><p role="alert" className="text-red-700">{error || "No se pudo cargar el portal."}</p></section></ModuleShell>;

  const { person, profile } = data;
  const notices = data.notices;
  const today = todayInTijuana();
  const localTime = timeInTijuana();
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const year = todayDate.getUTCFullYear();
  const birthdayDates = data.birthdays.map((birthday) => {
    const nextDate = new Date(Date.UTC(year, birthday.birth_month - 1, birthday.birth_day));
    if (nextDate < todayDate) nextDate.setUTCFullYear(year + 1);
    const previousDate = new Date(Date.UTC(year, birthday.birth_month - 1, birthday.birth_day));
    if (previousDate >= todayDate) previousDate.setUTCFullYear(year - 1);
    return { birthday, nextDate, previousDate, daysUntil: Math.round((nextDate.getTime() - todayDate.getTime()) / 86400000), daysSince: Math.round((todayDate.getTime() - previousDate.getTime()) / 86400000) };
  });
  const upcomingBirthdays = birthdayDates.filter((item) => item.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil);
  const previousBirthdays = birthdayDates.filter((item) => item.daysSince >= 1 && item.daysSince <= 30).sort((a, b) => a.daysSince - b.daysSince);
  const upcomingCommissions = data.commissions.filter((commission) => {
    if (commission.mass_date > today) return true;
    if (commission.mass_date < today) return false;
    const time = data.times.find((item) => item.id === commission.mass_time_id)?.time.slice(0, 5);
    return !!time && time >= localTime;
  });
  const upcomingActivities = data.activities.map((item) => Array.isArray(item.community_activities) ? item.community_activities[0] ?? null : item.community_activities).filter((item): item is NonNullable<typeof item> => !!item && item.status === "scheduled"
    && (item.activity_date > today || (item.activity_date === today && item.start_time.slice(0, 5) >= localTime))).sort((a, b) => a.activity_date.localeCompare(b.activity_date));
  const recorded = data.attendance.filter((item) => item.status === "present" || item.status === "absent");
  const present = recorded.filter((item) => item.status === "present").length;
  const attendancePercent = recorded.length ? Math.round((present / recorded.length) * 100) : null;
  const contributions = data.fundraising.map((participant) => {
    const payments = data.payments.filter((payment) => payment.event_id === participant.event_id && payment.status === "active");
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const fundraisingEvent = Array.isArray(participant.fundraising_events) ? participant.fundraising_events[0] ?? null : participant.fundraising_events;
    return { ...participant, fundraisingEvent, paid, due: Math.max(0, Number(participant.required_amount) - paid), payments };
  });
  const unreadCount = notices.filter((notice) => !notice.announcement_reads.length).length;
  const personName = person.display_name || `${person.first_name} ${person.last_name}`.trim();

  return <ModuleShell><section className="space-y-5">
    <header className="card-panel bg-[#13263d] p-5 text-white sm:p-7">
      <p className="text-sm font-bold uppercase tracking-wide text-amber-200">Portal del servidor</p>
      <h1 className="mt-1 text-2xl font-black sm:text-3xl">Hola, {personName}</h1>
      <p className="mt-2 text-sm text-slate-200">Consulta aquí tus comisiones, avisos, asistencias y aportaciones.</p>
    </header>
    <nav aria-label="Secciones del portal" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {[["#inicio", "Inicio"], ["#cumpleanos", "Cumpleaños"], ["#comisiones", "Mis comisiones"], ["#avisos", "Avisos"], ["#asistencias", "Mis asistencias"], ["#aportaciones", "Mis aportaciones"], ["#perfil", "Mi perfil"]].map(([href, label]) => <Link className="rounded-lg border bg-white p-3 text-center text-sm font-bold text-[#13263d] shadow-sm" key={href} href={href}>{label}</Link>)}
    </nav>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    {saved && <p role="status" className="text-sm font-semibold text-emerald-800">{saved}</p>}

    <section id="inicio" className="grid gap-3 sm:grid-cols-3">
      <a className="card-panel p-4" href="#avisos"><b>Avisos pendientes</b><p className="mt-2 text-2xl font-black">{unreadCount}</p></a>
      <a className="card-panel p-4" href="#comisiones"><b>Próximas comisiones</b><p className="mt-2 text-2xl font-black">{upcomingCommissions.length}</p></a>
      <a className="card-panel p-4" href="#asistencias"><b>Asistencia registrada</b><p className="mt-2 text-2xl font-black">{attendancePercent === null ? "Sin datos" : `${attendancePercent}%`}</p></a>
    </section>

    <section id="cumpleanos" className="card-panel scroll-mt-24 p-4 sm:p-6">
      <div className="mb-4"><h2 className="text-xl font-bold">Cumpleaños de servidores</h2><p className="mt-1 text-sm text-slate-600">Fechas de la comunidad, sin mostrar el año de nacimiento.</p></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><h3 className="mb-2 font-bold">Próximos 30 días</h3>{!upcomingBirthdays.length ? <p className="text-sm text-slate-600">No hay cumpleaños próximos en este periodo.</p> : <ul className="divide-y">{upcomingBirthdays.map(({ birthday, nextDate, daysUntil }) => <li key={birthday.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-semibold">{birthday.display_name || `${birthday.first_name} ${birthday.last_name}`.trim()}</span><span className="text-sm text-slate-600">{new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(nextDate)} · {daysUntil === 0 ? "hoy" : daysUntil === 1 ? "mañana" : `en ${daysUntil} días`}</span></li>)}</ul>}</div>
        <div><h3 className="mb-2 font-bold">Cumpleaños anteriores · últimos 30 días</h3>{!previousBirthdays.length ? <p className="text-sm text-slate-600">No hubo cumpleaños anteriores en este periodo.</p> : <ul className="divide-y">{previousBirthdays.map(({ birthday, previousDate, daysSince }) => <li key={birthday.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-semibold">{birthday.display_name || `${birthday.first_name} ${birthday.last_name}`.trim()}</span><span className="text-sm text-slate-600">{new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(previousDate)} · {daysSince === 1 ? "ayer" : `hace ${daysSince} días`}</span></li>)}</ul>}</div>
      </div>
    </section>

    <section id="comisiones" className="card-panel scroll-mt-24 p-4 sm:p-6">
      <h2 className="mb-4 text-xl font-bold">Mis próximas comisiones</h2>
      {!upcomingCommissions.length ? <p className="text-slate-600">No tienes comisiones confirmadas próximas.</p> : <div className="grid gap-3 md:grid-cols-2">
        {upcomingCommissions.map((commission) => {
          const visibility = previewVisibility(commission.preview_visibility);
          const time = data.times.find((item) => item.id === commission.mass_time_id);
          const ownAssignments = data.assignments.filter((item) => item.mass_id === commission.id).map((item) => ({
            ...item, service: Array.isArray(item.services) ? item.services[0] ?? null : item.services,
          })).filter((item) => item.service?.active
            && isServiceVisible(visibility, item.service_id) && isCategoryVisible(visibility, item.service.category_id));
          return <article className="rounded-lg border p-4" key={commission.id}>
            <p className="text-sm font-bold text-[#9a7438]">{new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Tijuana" }).format(new Date(`${commission.mass_date}T12:00:00`))} · {time?.name ?? time?.time ?? ""}</p>
            <h3 className="mt-1 text-lg font-bold">{commission.title}</h3>
            {commission.subtitle && <p className="text-sm text-slate-600">{commission.subtitle}</p>}
            <details className="mt-3"><summary className="cursor-pointer font-semibold">Ver detalle de mis servicios</summary>
              <ul className="mt-2 list-inside list-disc text-sm">{ownAssignments.map((item) => <li key={`${item.mass_id}-${item.service_id}`}>{item.service?.name}</li>)}</ul>
              {!ownAssignments.length && <p className="mt-2 text-sm text-slate-600">No hay servicios visibles para esta comisión.</p>}
            </details>
          </article>;
        })}
      </div>}
    </section>

    <section id="avisos" className="card-panel scroll-mt-24 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">Avisos y actividades</h2>{unreadCount > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">{unreadCount} sin leer</span>}</div>
      {!notices.length ? <p className="text-slate-600">No hay avisos publicados para ti.</p> : <div className="space-y-3">{notices.map((notice) => <article className={`rounded-lg border p-4 ${notice.announcement_reads.length ? "bg-white" : "border-amber-300 bg-amber-50"}`} key={notice.id}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase text-slate-500">{notice.priority} · {notice.published_at ? new Date(notice.published_at).toLocaleDateString("es-MX") : ""}</p><h3 className="mt-1 text-lg font-bold">{notice.title}</h3></div>{!notice.announcement_reads.length && <button className="border bg-white" onClick={() => void markAsRead(notice.id)}>Marcar leído</button>}</div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{notice.description}</p>
        {notice.expires_at && <p className="mt-2 text-xs text-slate-500">Vence: {new Date(notice.expires_at).toLocaleDateString("es-MX")}</p>}
        {notice.activity_id && <a className="mt-2 inline-block font-semibold text-[#13263d] underline" href="#asistencias">Ver actividades relacionadas</a>}
      </article>)}</div>}
      <h3 className="mt-6 font-bold">Próximas actividades</h3>
      {!upcomingActivities.length ? <p className="mt-2 text-sm text-slate-600">No tienes actividades próximas convocadas.</p> : <ul className="mt-2 divide-y">{upcomingActivities.map((activity) => <li className="py-2" key={activity.id}><b>{activity.name}</b> · {activity.activity_date} · {activity.start_time.slice(0, 5)}</li>)}</ul>}
    </section>

    <section id="asistencias" className="card-panel scroll-mt-24 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Mis asistencias</h2><p className="mt-1 text-sm text-slate-600">Historial personal y porcentaje sobre asistencias capturadas.</p></div><p className="text-2xl font-black">{attendancePercent === null ? "—" : `${attendancePercent}%`}</p></div>
      {!recorded.length ? <p className="mt-3 text-sm text-slate-600">Aún no hay asistencias capturadas para mostrar.</p> : <p className="mt-2 text-sm">{present} presentes de {recorded.length} registros.</p>}
      {upcomingActivities.length > 0 && <div className="mt-3"><h3 className="font-bold">Convocatorias próximas</h3><ul className="mt-1 list-inside list-disc text-sm">{upcomingActivities.map((activity) => <li key={activity.id}>{activity.name} · {activity.activity_date}</li>)}</ul></div>}
    </section>

    <section id="aportaciones" className="card-panel scroll-mt-24 p-4 sm:p-6">
      <h2 className="mb-1 text-xl font-bold">Mis aportaciones</h2><p className="mb-4 text-sm text-slate-600">Consulta de eventos e historial personal. No se pueden registrar pagos desde el portal.</p>
      {!contributions.length ? <p className="text-slate-600">No tienes aportaciones asignadas.</p> : <div className="space-y-3">{contributions.map((item) => <article className="rounded-lg border p-4" key={item.event_id}>
        <h3 className="font-bold">{item.fundraisingEvent?.name ?? "Evento"}</h3><p className="mt-1 text-sm">Asignado: {money(Number(item.required_amount))} · Aportado: {money(item.paid)} · Pendiente: {money(item.due)}</p>
        {!item.payments.length ? <p className="mt-2 text-sm text-slate-600">Sin pagos registrados.</p> : <ul className="mt-2 text-sm">{item.payments.map((payment, index) => <li key={`${payment.event_id}-${payment.paid_at}-${index}`}>{payment.paid_at}: {money(Number(payment.amount))} · {payment.status === "active" ? "Registrado" : "Anulado"}</li>)}</ul>}
      </article>)}</div>}
    </section>

    <section id="perfil" className="card-panel scroll-mt-24 p-4 sm:p-6">
      <h2 className="mb-4 text-xl font-bold">Mi perfil</h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-sm font-bold text-slate-600">Nombre</dt><dd>{profile.full_name || personName}</dd></div>
        <div><dt className="text-sm font-bold text-slate-600">Clase o grupo</dt><dd>{serverClassLabel(person.class_id as (typeof SERVER_CLASSES)[number]["id"] | null)}</dd></div>
        <div><dt className="text-sm font-bold text-slate-600">Celular de contacto</dt><dd>{profile.phone_contact || person.phone || "No registrado"} · {profile.phone_verified_at ? "verificado" : "no verificado"}</dd></div>
        <div><dt className="text-sm font-bold text-slate-600">Correo</dt><dd>{profile.email || person.email || "No registrado"}</dd></div>
        {person.gender && <div><dt className="text-sm font-bold text-slate-600">Género</dt><dd>{person.gender}</dd></div>}
      </dl>
      <PhoneLinkForm /><p className="mt-4 text-sm text-slate-500">Los datos administrativos solo pueden modificarse desde Administración.</p>
    </section>
  </section></ModuleShell>;
}
