-- Aplicar solo después de revisar. No se ejecuta contra el proyecto remoto aquí.
alter table public.fundraising_participants
  add column if not exists status text not null default 'active'
  check (status in ('active', 'cancelled'));
alter table public.fundraising_participants
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

alter table public.fundraising_payments
  add column if not exists request_id uuid;
create unique index if not exists fundraising_payments_request_id_idx
  on public.fundraising_payments(request_id) where request_id is not null;
create index if not exists fundraising_participants_event_status_idx
  on public.fundraising_participants(event_id, status);

-- El permiso individual prevalece sobre el rol predeterminado.
create or replace function public.can_manage_treasury()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_app_permission('treasury.manage');
$$;
revoke all on function public.can_manage_treasury() from public, anon;
grant execute on function public.can_manage_treasury() to authenticated;

create or replace function public.add_fundraising_participants(
  p_event_id uuid, p_server_ids uuid[]
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event public.fundraising_events%rowtype;
  v_count integer;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  select * into v_event from public.fundraising_events
    where id=p_event_id and parish_id=public.current_parish() for update;
  if not found or v_event.status <> 'active' then raise exception 'Evento no disponible.'; end if;
  if exists (
    select 1 from unnest(coalesce(p_server_ids, '{}'::uuid[])) sid
    left join public.people pe on pe.id=sid and pe.parish_id=v_event.parish_id and pe.active
    where pe.id is null
  ) then raise exception 'Hay servidores no disponibles.'; end if;
  with candidates as (
    select distinct sid as server_id from unnest(coalesce(p_server_ids, '{}'::uuid[])) sid
  ), changed as (
    insert into public.fundraising_participants(event_id,server_id,required_amount,status,cancelled_at,cancelled_by)
    select p_event_id,server_id,v_event.suggested_amount,'active',null,null from candidates
    on conflict (event_id,server_id) do update
      set status='active',cancelled_at=null,cancelled_by=null,updated_at=now()
      where fundraising_participants.status='cancelled'
    returning id
  ) select count(*) into v_count from changed;
  insert into public.treasury_audit(parish_id,action,new_values,performed_by)
    values(v_event.parish_id,'participants_added',
      jsonb_build_object('event_id',p_event_id,'server_ids',p_server_ids,'changed',v_count),auth.uid());
  return v_count;
end $$;
revoke all on function public.add_fundraising_participants(uuid,uuid[]) from public, anon;
grant execute on function public.add_fundraising_participants(uuid,uuid[]) to authenticated;

create or replace function public.remove_fundraising_participant(
  p_event_id uuid, p_server_id uuid
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_participant public.fundraising_participants%rowtype;
  v_parish uuid;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  select parish_id into v_parish from public.fundraising_events
    where id=p_event_id and parish_id=public.current_parish() and status='active' for update;
  if not found then raise exception 'Evento no disponible.'; end if;
  select * into v_participant from public.fundraising_participants
    where event_id=p_event_id and server_id=p_server_id and status='active' for update;
  if not found then raise exception 'Participante no encontrado.'; end if;
  if exists(select 1 from public.fundraising_payments where participant_id=v_participant.id) then
    update public.fundraising_participants set status='cancelled',cancelled_at=now(),
      cancelled_by=auth.uid(),updated_at=now() where id=v_participant.id;
    insert into public.treasury_audit(parish_id,action,old_values,new_values,performed_by)
      values(v_parish,'participant_cancelled',
        jsonb_build_object('event_id',p_event_id,'server_id',p_server_id),
        jsonb_build_object('participant_id',v_participant.id,'status','cancelled'),auth.uid());
    return 'cancelled';
  end if;
  delete from public.fundraising_participants where id=v_participant.id;
  insert into public.treasury_audit(parish_id,action,old_values,performed_by)
    values(v_parish,'participant_removed',
      jsonb_build_object('event_id',p_event_id,'server_id',p_server_id),auth.uid());
  return 'removed';
end $$;
revoke all on function public.remove_fundraising_participant(uuid,uuid) from public, anon;
grant execute on function public.remove_fundraising_participant(uuid,uuid) to authenticated;

create or replace function public.update_fundraising_event(
  p_event_id uuid, p_name text, p_description text, p_deadline date, p_suggested_amount numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare v_event public.fundraising_events%rowtype;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if nullif(btrim(p_name),'') is null or p_suggested_amount is null
    or p_suggested_amount < 0 or p_suggested_amount > 9999999999.99
    then raise exception 'Datos de evento inválidos.'; end if;
  select * into v_event from public.fundraising_events
    where id=p_event_id and parish_id=public.current_parish() for update;
  if not found or v_event.status <> 'active' then raise exception 'Evento no disponible.'; end if;
  update public.fundraising_events set name=btrim(p_name),description=p_description,
    deadline=p_deadline,suggested_amount=p_suggested_amount,updated_by=auth.uid(),updated_at=now()
    where id=p_event_id;
  update public.fundraising_participants set required_amount=p_suggested_amount,updated_at=now()
    where event_id=p_event_id and status='active';
  insert into public.treasury_audit(parish_id,action,old_values,new_values,performed_by)
    values(v_event.parish_id,'event_updated',
      jsonb_build_object('event_id',p_event_id,'name',v_event.name,'amount',v_event.suggested_amount),
      jsonb_build_object('name',p_name,'amount',p_suggested_amount),auth.uid());
end $$;
revoke all on function public.update_fundraising_event(uuid,text,text,date,numeric) from public, anon;
grant execute on function public.update_fundraising_event(uuid,text,text,date,numeric) to authenticated;

create or replace function public.register_fundraising_payment_once(
  p_event_id uuid, p_server_id uuid, p_request_id uuid,
  p_amount numeric default null, p_paid_at date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_event public.fundraising_events%rowtype;
  v_participant public.fundraising_participants%rowtype;
  v_payment_id uuid;
  v_paid numeric;
  v_amount numeric;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_request_id is null then raise exception 'Identificador de operación requerido.'; end if;
  select * into v_event from public.fundraising_events
    where id=p_event_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Evento no encontrado.'; end if;
  select id into v_payment_id from public.fundraising_payments
    where request_id=p_request_id and parish_id=v_event.parish_id;
  if found then
    if not exists(select 1 from public.fundraising_payments
      where id=v_payment_id and event_id=p_event_id and server_id=p_server_id)
      then raise exception 'Identificador de operación ya utilizado.'; end if;
    return v_payment_id;
  end if;
  if v_event.status <> 'active' then raise exception 'El evento no está activo.'; end if;
  select * into v_participant from public.fundraising_participants
    where event_id=p_event_id and server_id=p_server_id and status='active' for update;
  if not found then raise exception 'El servidor no participa en el evento.'; end if;
  select coalesce(sum(amount),0) into v_paid from public.fundraising_payments
    where participant_id=v_participant.id and status='active';
  v_amount := coalesce(p_amount,v_participant.required_amount-v_paid);
  if v_amount is null or v_amount <= 0 or v_amount > 9999999999.99
    then raise exception 'Importe inválido o aportación ya completada.'; end if;
  v_payment_id := public.register_fundraising_payment(p_event_id,p_server_id,v_amount,p_paid_at);
  update public.fundraising_payments set request_id=p_request_id where id=v_payment_id;
  return v_payment_id;
end $$;
revoke all on function public.register_fundraising_payment_once(uuid,uuid,uuid,numeric,date) from public, anon;
grant execute on function public.register_fundraising_payment_once(uuid,uuid,uuid,numeric,date) to authenticated;
-- Evita saltarse el control de participante e idempotencia con la función antigua.
revoke execute on function public.register_fundraising_payment(uuid,uuid,numeric,date) from authenticated;
