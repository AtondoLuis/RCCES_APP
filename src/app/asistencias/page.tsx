"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@/components/module-shell";
import { createClient } from "@/lib/supabase/client";
import { permissionsFor } from "@/lib/permissions";
import { SERVER_CLASSES } from "@/lib/server-classes";

type ActivityType={id:string;name:string;active:boolean};
type Activity={id:string;name:string;activity_date:string;start_time:string;status:string;capture_status:string;activity_type_id:string};
type Person={id:string;first_name:string;last_name:string;display_name:string|null;active:boolean;class_id:string|null};
type Participant={server_id:string};
type RecordRow={server_id:string;status:"pending"|"present"|"absent"};

export default function AttendancePage(){
 const supabase=useMemo(()=>createClient(),[]);
 const [types,setTypes]=useState<ActivityType[]>([]); const [activities,setActivities]=useState<Activity[]>([]);
 const [people,setPeople]=useState<Person[]>([]); const [participants,setParticipants]=useState<Participant[]>([]);
 const [records,setRecords]=useState<RecordRow[]>([]); const [selectedActivity,setSelectedActivity]=useState("");
 const [typeId,setTypeId]=useState(""); const [name,setName]=useState(""); const [date,setDate]=useState(""); const [time,setTime]=useState("19:00");
 const [query,setQuery]=useState(""); const [classFilter,setClassFilter]=useState(""); const [error,setError]=useState(""); const [saved,setSaved]=useState("");
 const [statusFilter,setStatusFilter]=useState("active");
 const [canManage,setCanManage]=useState(false);

 const load=useCallback(async()=>{
  if(!supabase)return;
  const profile=await supabase.from("profiles").select("role").maybeSingle();
  if(profile.error||!profile.data?.role){setError(profile.error?.message??"No se pudo verificar el perfil.");return;}
  setCanManage(permissionsFor(profile.data.role).manageAttendance);
  const [typeRes,activityRes,peopleRes]=await Promise.all([
   supabase.from("activity_types").select("id,name,active").eq("active",true).order("display_order"),
   supabase.from("community_activities").select("id,name,activity_date,start_time,status,capture_status,activity_type_id").order("activity_date",{ascending:false}),
   supabase.from("people").select("id,first_name,last_name,display_name,active,class_id").order("first_name"),
  ]);
  if(typeRes.error||activityRes.error||peopleRes.error)setError(typeRes.error?.message||activityRes.error?.message||peopleRes.error?.message||"");
  setTypes((typeRes.data??[])as ActivityType[]);setActivities((activityRes.data??[])as Activity[]);setPeople((peopleRes.data??[])as Person[]);
 },[supabase]);
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

 async function createActivity(){
  if(!supabase||!typeId||!name.trim()||!date)return;
  const profile=await supabase.from("profiles").select("parish_id").maybeSingle();
  if(profile.error||!profile.data?.parish_id){setError("No se pudo determinar la parroquia.");return;}
  const result=await supabase.from("community_activities").insert({parish_id:profile.data.parish_id,activity_type_id:typeId,name:name.trim(),activity_date:date,start_time:time,status:"scheduled",capture_status:"pending"}).select("id").single();
  if(result.error)setError(result.error.message);else{setSaved("Actividad creada");setName("");setDate("");await load();setSelectedActivity(result.data.id);}
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
   <h2 className="mb-3 font-bold">Nueva actividad</h2>
   <div className="grid gap-3 md:grid-cols-5"><select value={typeId} onChange={(e)=>setTypeId(e.target.value)}><option value="">Tipo</option>{types.map((type)=><option key={type.id} value={type.id}>{type.name}</option>)}</select><input className="md:col-span-2" placeholder="Nombre" value={name} onChange={(e)=>setName(e.target.value)} /><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} /><input type="time" value={time} onChange={(e)=>setTime(e.target.value)} /></div>
   <button className="button-link primary mt-3" onClick={()=>void createActivity()}>Crear actividad</button>
  </section>}
  <section className="no-print mb-5 card-panel p-4">
   <label className="block"><span className="mb-1 block text-sm font-bold">Actividad</span><select value={selectedActivity} onChange={(e)=>setSelectedActivity(e.target.value)}><option value="">Selecciona una actividad</option>{activities.map((activity)=><option key={activity.id} value={activity.id}>{activity.name} · {dateLabel(activity.activity_date)}</option>)}</select></label>
  </section>
  {selectedActivity&&<>
   <div className="no-print mb-4 flex flex-wrap items-center gap-3"><div className="card-panel px-4 py-3"><b>{presentCount}</b> presentes · <b>{absentCount}</b> ausentes · <b>{participants.length}</b> convocados</div><input placeholder="Buscar servidor" value={query} onChange={(e)=>setQuery(e.target.value)} /><select value={classFilter} onChange={(e)=>setClassFilter(e.target.value)}><option value="">Todas las clases</option>{SERVER_CLASSES.map((item)=><option key={item.id} value={item.id}>{item.label}</option>)}</select><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option></select>{canManage&&selectedActivityData?.capture_status!=="closed"&&<button className="button-link border" onClick={()=>void closeCapture()}>Guardar y cerrar</button>}</div>
   <div className="mb-3"><b>{selectedActivityData?.name}</b> · {selectedActivityData&&dateLabel(selectedActivityData.activity_date)} · {selectedActivityData?.start_time.slice(0,5)}</div>
   {canManage&&<section className="no-print mb-5 card-panel p-4"><h2 className="mb-3 font-bold">Convocar servidores</h2><button className="button-link border mb-2" onClick={()=>{for(const person of people.filter((p)=>p.active&&!participants.some((entry)=>entry.server_id===p.id)))void addParticipant(person.id);}}>Añadir todos los activos</button><div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{people.filter((p)=>p.active&&!participants.some((entry)=>entry.server_id===p.id)).map((person)=><button key={person.id} type="button" className="rounded border p-2 text-left" onClick={()=>void addParticipant(person.id)}>{person.display_name||`${person.first_name} ${person.last_name}`}</button>)}</div></section>}
   <section className="grid gap-3">{visiblePeople.map((person)=>{const record=records.find((r)=>r.server_id===person.id);const present=record?.status==="present";return <button key={person.id} disabled={!canManage||selectedActivityData?.capture_status==="closed"} onClick={()=>void toggle(person.id,!present)} className={`flex min-h-16 items-center justify-between rounded-lg border p-4 text-left ${present?"border-emerald-600 bg-emerald-50":"bg-white"}`}><span className="font-bold">{person.display_name||`${person.first_name} ${person.last_name}`}</span><span className={`text-lg ${present?"text-emerald-700":"text-slate-400"}`}>{present?"Presente":record?.status==="absent"?"Ausente":"Pendiente"}</span></button>;})}</section>
  </>}
 </ModuleShell>;
}
