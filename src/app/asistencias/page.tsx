"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { createClient } from "@/lib/supabase/client";
import { SERVER_CLASSES } from "@/lib/server-classes";

type ActivityType={id:string;name:string;active:boolean};
type Activity={id:string;name:string;activity_date:string;start_time:string;status:string;capture_status:string;activity_type_id:string};
type Person={id:string;first_name:string;last_name:string;display_name:string|null;active:boolean;class_id:string|null};
type Participant={server_id:string};
type RecordRow={server_id:string;status:"pending"|"present"|"absent"};
const activityColumns = "id,name,activity_date,start_time,status,capture_status,activity_type_id";

export default function AttendancePage(){
 const supabase=useMemo(()=>createClient(),[]);
 const [types,setTypes]=useState<ActivityType[]>([]); const [activities,setActivities]=useState<Activity[]>([]);
 const [people,setPeople]=useState<Person[]>([]); const [participants,setParticipants]=useState<Participant[]>([]);
 const [records,setRecords]=useState<RecordRow[]>([]); const [selectedActivity,setSelectedActivity]=useState("");
 const [typeId,setTypeId]=useState(""); const [name,setName]=useState(""); const [date,setDate]=useState(""); const [time,setTime]=useState("19:00");
 const [query,setQuery]=useState(""); const [classFilter,setClassFilter]=useState(""); const [error,setError]=useState(""); const [saved,setSaved]=useState("");
 const [statusFilter,setStatusFilter]=useState("active");
 const [canManage,setCanManage]=useState(false);
 const [editingActivity,setEditingActivity]=useState<Activity | null>(null);
 const [savingActivity,setSavingActivity]=useState(false);

 const loadCurrentProfile=useCallback(async()=>{
  if(!supabase)return null;
  const {data:userData,error:userError}=await supabase.auth.getUser();
  if(userError||!userData.user){setError(userError?.message??"No se pudo verificar la sesión.");return null;}
  const profile=await supabase.from("profiles").select("role,parish_id").eq("id",userData.user.id).maybeSingle();
  if(profile.error||!profile.data){setError(profile.error?.message??"No se encontró el perfil activo.");return null;}
  return { ...profile.data, id: userData.user.id };
 },[supabase]);

 const load=useCallback(async()=>{
  if(!supabase)return;
  const profile=await loadCurrentProfile();
  if(!profile?.role)return;
  const permission=await supabase.rpc("has_app_permission",{p_permission:"attendance.manage"});
  if(permission.error){setError(permission.error.message);return;}
  setCanManage(permission.data===true);
  const [typeRes,activityRes,peopleRes]=await Promise.all([
   supabase.from("activity_types").select("id,name,active").order("display_order"),
   supabase.from("community_activities").select(activityColumns).order("activity_date",{ascending:false}),
   supabase.from("people").select("id,first_name,last_name,display_name,active,class_id").order("first_name"),
  ]);
  if(typeRes.error||activityRes.error||peopleRes.error)setError(typeRes.error?.message||activityRes.error?.message||peopleRes.error?.message||"");
  setTypes((typeRes.data??[])as ActivityType[]);setActivities((activityRes.data??[])as Activity[]);setPeople((peopleRes.data??[])as Person[]);
 },[loadCurrentProfile,supabase]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);},[load]);
 useEffect(()=>{
  if(!supabase||!selectedActivity)return;
  void Promise.all([
   supabase.from("activity_participants").select("server_id").eq("activity_id",selectedActivity),
   supabase.from("attendance_records").select("server_id,status").eq("activity_id",selectedActivity),
  ]).then(([p,r])=>{
   if(p.error||r.error)setError(p.error?.message||r.error?.message||"");else{
    setParticipants((p.data??[])as Participant[]);setRecords((r.data??[])as RecordRow[]);
   }
  });
 },[selectedActivity,supabase]);

 function startEditing(activity: Activity) {
  setError("");
  setSaved("");
  setEditingActivity(activity);
  setTypeId(activity.activity_type_id);
  setName(activity.name);
  setDate(activity.activity_date);
  setTime(activity.start_time);
 }

 function resetActivityForm() {
  setEditingActivity(null);
  setTypeId("");
  setName("");
  setDate("");
  setTime("19:00");
 }

 async function saveActivity(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!supabase || !canManage || savingActivity || !typeId || !name.trim() || !date || !time) return;
  setError("");
  setSaved("");
  setSavingActivity(true);
  try {
   const profile = await loadCurrentProfile();
   if (!profile?.parish_id) return;
   const details = { activity_type_id: typeId, name: name.trim(), activity_date: date, start_time: time };
   const table = supabase.from("community_activities");
   if (editingActivity) {
    const result = await table.update({ ...details, updated_by: profile.id, updated_at: new Date().toISOString() })
     .eq("id", editingActivity.id)
     .eq("parish_id", profile.parish_id)
     .eq("activity_type_id", editingActivity.activity_type_id)
     .eq("name", editingActivity.name)
     .eq("activity_date", editingActivity.activity_date)
     .eq("start_time", editingActivity.start_time)
     .select("id").maybeSingle();
    if (result.error) {
     setError(result.error.message);
     return;
    }
    if (!result.data) {
     await load();
     setError("No se pudo guardar. Cancela la edición y vuelve a abrir la actividad para cargar sus datos actuales.");
     return;
    }
    resetActivityForm();
    setSaved("Actividad actualizada");
   } else {
    const result = await table.insert({ ...details, parish_id: profile.parish_id, status: "scheduled", capture_status: "pending" }).select("id").single();
    if (result.error) {
     setError(result.error.message);
     return;
    }
    setName("");
    setDate("");
    setSelectedActivity(result.data.id);
    setSaved("Actividad creada");
   }
   await load();
  } finally {
   setSavingActivity(false);
  }
 }
 async function addParticipant(serverId:string){
  if(!supabase||!selectedActivity)return;
  const result=await supabase.from("activity_participants").insert({activity_id:selectedActivity,server_id:serverId});
  if(result.error)setError(result.error.message);else{
   setParticipants((current)=>current.some((p)=>p.server_id===serverId)?current:[...current,{server_id:serverId}]);
  }
 }
 async function toggle(serverId:string,present:boolean){
  if(!supabase||!selectedActivity)return;
  const result=await supabase.rpc("toggle_attendance",{p_activity_id:selectedActivity,p_server_id:serverId,p_present:present});
  if(result.error)setError(result.error.message);else{
   setSaved("Asistencia guardada");
   setRecords((current)=>{const next=current.filter((r)=>r.server_id!==serverId);return [...next,{server_id:serverId,status:present?"present":"absent"}];});
  }
 }
 async function closeCapture(){
  if(!supabase||!selectedActivity||!window.confirm("¿Cerrar la captura? Los convocados no marcados se registrarán como ausentes."))return;
  const result=await supabase.rpc("close_attendance_capture",{p_activity_id:selectedActivity});
  if(result.error)setError(result.error.message);else{
   setSaved("Captura cerrada");await load();
   setRecords((current)=>current.map((r)=>r.status==="present"?r:{...r,status:"absent"}));
  }
 }
 const visiblePeople=people.filter((person)=>participants.some((p)=>p.server_id===person.id))
  .filter((person)=>statusFilter==="all"||(statusFilter==="active"?person.active:!person.active))
  .filter((person)=>!query||`${person.first_name} ${person.last_name} ${person.display_name??""}`.toLowerCase().includes(query.toLowerCase()))
  .filter((person)=>!classFilter||person.class_id===classFilter);
 const presentCount=records.filter((r)=>r.status==="present").length;
 const absentCount=records.filter((r)=>r.status==="absent").length;
 const selectedActivityData=activities.find((activity)=>activity.id===selectedActivity);
 const dateLabel=(value:string)=>new Intl.DateTimeFormat("es-MX",{timeZone:"America/Tijuana",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(`${value}T12:00:00`));
 function exportAttendanceCsv(){
  if(!selectedActivityData)return;
  const rows=[["Servidor","Estado","Actividad","Fecha"],...participants.map((participant)=>{
   const person=people.find((item)=>item.id===participant.server_id);
   const status=records.find((record)=>record.server_id===participant.server_id)?.status??"pending";
   return[person?.display_name||`${person?.first_name??""} ${person?.last_name??""}`,status,selectedActivityData.name,selectedActivityData.activity_date];
  })];
  const content=rows.map((row)=>row.map((value)=>`"${String(value).replaceAll("\"","\"\"")}"`).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob(["\ufeff",content],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="reporte-asistencia.csv";link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }

 return <ModuleShell>
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-[#b18b4a]">Comunidad</p><h1 className="text-2xl font-bold">Asistencias</h1></div>{selectedActivity&&<div className="no-print flex gap-2"><button className="border bg-white" onClick={exportAttendanceCsv}>Exportar CSV</button><button className="border bg-white" onClick={()=>window.print()}>Exportar PDF</button></div>}</div>
  {error&&<div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
  {saved&&<div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{saved}</div>}
  {canManage&&<section className="no-print mb-5 card-panel p-4">
   <h2 className="mb-3 font-bold">{editingActivity ? "Editar actividad" : "Nueva actividad"}</h2>
   <form onSubmit={saveActivity}>
    <fieldset disabled={savingActivity}>
     <div className="grid gap-3 md:grid-cols-5">
      <select aria-label="Tipo de actividad" required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
       <option value="">Tipo</option>
       {types.filter((type) => type.active || type.id === editingActivity?.activity_type_id).map((type) =>
        <option key={type.id} value={type.id}>{type.name}{type.active ? "" : " (inactivo)"}</option>
       )}
      </select>
      <input aria-label="Nombre" className="md:col-span-2" placeholder="Nombre" required value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Fecha" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      <input aria-label="Hora" type="time" step="any" required value={time} onChange={(e) => setTime(e.target.value)} />
     </div>
     <div className="mt-3 flex gap-2">
      <button type="submit" className="button-link primary" disabled={!name.trim()}>
       {savingActivity ? "Guardando…" : editingActivity ? "Guardar cambios" : "Crear actividad"}
      </button>
      {editingActivity && <button type="button" className="button-link border" onClick={() => { resetActivityForm(); setError(""); }}>Cancelar</button>}
     </div>
    </fieldset>
   </form>
  </section>}
  <section className="no-print mb-5 card-panel p-4">
   <label className="block"><span className="mb-1 block text-sm font-bold">Actividad</span><select disabled={savingActivity || Boolean(editingActivity)} value={selectedActivity} onChange={(e)=>setSelectedActivity(e.target.value)}><option value="">Selecciona una actividad</option>{activities.map((activity)=><option key={activity.id} value={activity.id}>{activity.name} · {dateLabel(activity.activity_date)}</option>)}</select></label>
   {canManage && selectedActivityData && !editingActivity && (
    <button type="button" className="button-link border mt-3" disabled={savingActivity} onClick={() => startEditing(selectedActivityData)}>
     Editar actividad
    </button>
   )}
  </section>
  {selectedActivity&&<>
   <div className="no-print mb-4 flex flex-wrap items-center gap-3"><div className="card-panel px-4 py-3"><b>{presentCount}</b> presentes · <b>{absentCount}</b> ausentes · <b>{participants.length}</b> convocados</div><input placeholder="Buscar servidor" value={query} onChange={(e)=>setQuery(e.target.value)} /><select value={classFilter} onChange={(e)=>setClassFilter(e.target.value)}><option value="">Todas las clases</option>{SERVER_CLASSES.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option></select>{canManage&&selectedActivityData?.capture_status!=="closed"&&<button className="button-link border" onClick={()=>void closeCapture()}>Guardar y cerrar</button>}</div>
   <div className="mb-3"><b>{selectedActivityData?.name}</b> · {selectedActivityData&&dateLabel(selectedActivityData.activity_date)} · {selectedActivityData?.start_time.slice(0,5)}</div>
   {canManage&&<section className="no-print mb-5 card-panel p-4"><h2 className="mb-3 font-bold">Convocar servidores</h2><button className="button-link border mb-2" onClick={()=>{for(const person of people.filter((p)=>p.active&&!participants.some((entry)=>entry.server_id===p.id)))void addParticipant(person.id);}}>Añadir todos los activos</button><div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{people.filter((p)=>p.active&&!participants.some((entry)=>entry.server_id===p.id)).map((person)=><button key={person.id} type="button" className="rounded border p-2 text-left" onClick={()=>void addParticipant(person.id)}>{person.display_name||`${person.first_name} ${person.last_name}`}</button>)}</div></section>}
   <section className="grid gap-3">{visiblePeople.map((person)=>{const record=records.find((r)=>r.server_id===person.id);const present=record?.status==="present";return <button key={person.id} disabled={!canManage||selectedActivityData?.capture_status==="closed"} onClick={()=>void toggle(person.id,!present)} className={`flex min-h-16 items-center justify-between rounded-lg border p-4 text-left ${present?"border-emerald-600 bg-emerald-50":"bg-white"}`}><span className="font-bold">{person.display_name||`${person.first_name} ${person.last_name}`}</span><span className={`text-lg ${present?"text-emerald-700":"text-slate-400"}`}>{present?"Presente":record?.status==="absent"?"Ausente":"Pendiente"}</span></button>;})}</section>
  </>}
 </ModuleShell>;
}
