-- Allow authorized attendance managers to correct records after capture is closed.
-- Preserve parish scoping and require the server to have been invited to the activity.
create or replace function public.toggle_attendance(p_activity_id uuid,p_server_id uuid,p_present boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_activity public.community_activities%rowtype;
begin
  if not public.can_manage_attendance() then raise exception 'No autorizado.'; end if;
  select * into v_activity from public.community_activities
  where id=p_activity_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Actividad no encontrada.'; end if;
  if not exists (
    select 1 from public.activity_participants ap
    where ap.activity_id=p_activity_id and ap.server_id=p_server_id
  ) then raise exception 'El servidor no está convocado a esta actividad.'; end if;
  insert into public.attendance_records(activity_id,server_id,status,marked_by,marked_at)
  values (p_activity_id,p_server_id,case when p_present then 'present' else 'absent' end,auth.uid(),now())
  on conflict(activity_id,server_id) do update set
    status=excluded.status,marked_by=excluded.marked_by,marked_at=excluded.marked_at,updated_at=now();
  return case when p_present then 'present' else 'absent' end;
end $$;
revoke all on function public.toggle_attendance(uuid,uuid,boolean) from public, anon;
grant execute on function public.toggle_attendance(uuid,uuid,boolean) to authenticated;
