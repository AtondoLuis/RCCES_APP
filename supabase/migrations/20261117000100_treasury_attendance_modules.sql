create table public.treasury_transactions (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete restrict,
  transaction_date date not null default (now() at time zone 'America/Tijuana')::date,
  description text not null,
  transaction_type text not null check (transaction_type in ('entrada','salida')),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null check (category in ('donacion','aportacion','venta','gasto','retiro','otro')),
  fundraising_event_id uuid,
  fundraising_payment_id uuid,
  server_id uuid references public.people(id) on delete restrict,
  observations text,
  status text not null default 'active' check (status in ('active','voided')),
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fundraising_payment_id)
);

create table public.fundraising_events (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete restrict,
  name text not null,
  description text,
  created_date date not null default (now() at time zone 'America/Tijuana')::date,
  deadline date,
  suggested_amount numeric(12,2) not null default 0 check (suggested_amount >= 0),
  status text not null default 'active' check (status in ('active','finished','cancelled')),
  observations text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.treasury_transactions
  add constraint treasury_event_fk foreign key (fundraising_event_id)
  references public.fundraising_events(id) on delete restrict;

create table public.fundraising_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.fundraising_events(id) on delete restrict,
  server_id uuid not null references public.people(id) on delete restrict,
  required_amount numeric(12,2) not null check (required_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, server_id)
);

create table public.fundraising_payments (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete restrict,
  event_id uuid not null references public.fundraising_events(id) on delete restrict,
  participant_id uuid not null references public.fundraising_participants(id) on delete restrict,
  server_id uuid not null references public.people(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null default (now() at time zone 'America/Tijuana')::date,
  status text not null default 'active' check (status in ('active','voided')),
  void_reason text,
  received_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.treasury_transactions
  add constraint treasury_payment_fk foreign key (fundraising_payment_id)
  references public.fundraising_payments(id) on delete restrict;

create table public.treasury_audit (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete restrict,
  transaction_id uuid references public.treasury_transactions(id) on delete restrict,
  payment_id uuid references public.fundraising_payments(id) on delete restrict,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parish_id, name)
);

create table public.community_activities (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  activity_type_id uuid not null references public.activity_types(id) on delete restrict,
  name text not null,
  activity_date date not null,
  start_time time not null,
  course int,
  class_number int,
  description text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  capture_status text not null default 'pending' check (capture_status in ('pending','closed')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_participants (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.community_activities(id) on delete cascade,
  server_id uuid not null references public.people(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(activity_id, server_id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.community_activities(id) on delete cascade,
  server_id uuid not null references public.people(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','present','absent')),
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(activity_id, server_id)
);

create table public.activity_recurrences (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  activity_type_id uuid not null references public.activity_types(id) on delete restrict,
  name text not null,
  start_time time not null,
  recurrence text not null check (recurrence in ('weekly','biweekly','monthly')),
  start_date date not null,
  end_date date,
  course int,
  class_number int,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index treasury_transactions_parish_date_idx on public.treasury_transactions(parish_id, transaction_date desc);
create index treasury_transactions_event_idx on public.treasury_transactions(fundraising_event_id);
create index fundraising_events_parish_status_idx on public.fundraising_events(parish_id, status);
create index fundraising_payments_event_idx on public.fundraising_payments(event_id);
create index activity_types_parish_idx on public.activity_types(parish_id, active);
create index community_activities_parish_date_idx on public.community_activities(parish_id, activity_date desc);
create index attendance_activity_status_idx on public.attendance_records(activity_id, status);
create index attendance_server_idx on public.attendance_records(server_id);

insert into public.activity_types(parish_id,name,display_order)
select p.id,t.name,t.display_order
from public.parishes p
cross join (values
  ('Asamblea',1),('PGO',2),('Enseñanza',3),('Crecimiento',4),('Misa',5),
  ('Retiro',6),('Limpieza',7),('Convivio',8),('Servicio comunitario',9),('Otra actividad',10)
) as t(name,display_order)
on conflict (parish_id,name) do nothing;

create function app_private.is_linked_server(p_server_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.profiles where id=auth.uid() and person_id=p_server_id);
$$;
revoke all on function app_private.is_linked_server(uuid) from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_linked_server(uuid) to authenticated;

create function app_private.is_linked_activity_participant(p_activity_id uuid,p_parish_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.activity_participants ap
    join public.community_activities ca on ca.id=ap.activity_id
    join public.profiles pr on pr.person_id=ap.server_id
    where ap.activity_id=p_activity_id and ca.parish_id=p_parish_id and pr.id=auth.uid()
  );
$$;
revoke all on function app_private.is_linked_activity_participant(uuid,uuid) from public, anon, authenticated;
grant execute on function app_private.is_linked_activity_participant(uuid,uuid) to authenticated;

create function app_private.seed_default_activity_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_types(parish_id,name,display_order)
  values
    (new.id,'Asamblea',1),(new.id,'PGO',2),(new.id,'Enseñanza',3),(new.id,'Crecimiento',4),
    (new.id,'Misa',5),(new.id,'Retiro',6),(new.id,'Limpieza',7),(new.id,'Convivio',8),
    (new.id,'Servicio comunitario',9),(new.id,'Otra actividad',10)
  on conflict (parish_id,name) do nothing;
  return new;
end $$;
revoke all on function app_private.seed_default_activity_types() from public, anon, authenticated;
create trigger seed_default_activity_types_after_parish_insert
after insert on public.parishes
for each row execute function app_private.seed_default_activity_types();

create or replace function public.can_manage_treasury()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role()::text in ('ADMIN','TESORERO'), false);
$$;
revoke all on function public.can_manage_treasury() from public, anon;
grant execute on function public.can_manage_treasury() to authenticated;

create or replace function public.can_manage_attendance()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role()::text in ('ADMIN','COORDINADOR','COORDINADOR_LITURGIA'), false);
$$;
revoke all on function public.can_manage_attendance() from public, anon;
grant execute on function public.can_manage_attendance() to authenticated;

create or replace function public.register_fundraising_payment(
  p_event_id uuid,
  p_server_id uuid,
  p_amount numeric,
  p_paid_at date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.fundraising_participants%rowtype;
  v_event public.fundraising_events%rowtype;
  v_payment_id uuid;
  v_transaction_id uuid;
begin
  if not public.can_manage_treasury() then
    raise exception 'No autorizado para registrar aportaciones.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 then
    raise exception 'El importe debe ser mayor a cero.';
  end if;
  select * into v_event from public.fundraising_events
  where id = p_event_id and parish_id = public.current_parish() for update;
  if not found then raise exception 'Evento no encontrado.'; end if;
  if v_event.status <> 'active' then raise exception 'El evento no esta activo.'; end if;
  select * into v_participant from public.fundraising_participants
  where event_id = p_event_id and server_id = p_server_id for share;
  if not found then raise exception 'El servidor no participa en el evento.'; end if;

  insert into public.fundraising_payments(
    parish_id,event_id,participant_id,server_id,amount,paid_at,received_by
  ) values (
    v_event.parish_id,p_event_id,v_participant.id,p_server_id,p_amount,
    coalesce(p_paid_at,(now() at time zone 'America/Tijuana')::date),auth.uid()
  ) returning id into v_payment_id;

  insert into public.treasury_transactions(
    parish_id,transaction_date,description,transaction_type,amount,category,
    fundraising_event_id,fundraising_payment_id,server_id,created_by,updated_by
  ) values (
    v_event.parish_id,coalesce(p_paid_at,(now() at time zone 'America/Tijuana')::date),
    'Aportacion — ' || v_event.name || ' — ' ||
      coalesce((select display_name from public.people where id = p_server_id),
               (select first_name || ' ' || last_name from public.people where id = p_server_id)),
    'entrada',p_amount,'aportacion',p_event_id,v_payment_id,p_server_id,auth.uid(),auth.uid()
  ) returning id into v_transaction_id;

  insert into public.treasury_audit(parish_id,transaction_id,payment_id,action,new_values,performed_by)
  values (v_event.parish_id,v_transaction_id,v_payment_id,'payment_registered',
          jsonb_build_object('amount',p_amount,'paid_at',coalesce(p_paid_at,(now() at time zone 'America/Tijuana')::date)),
          auth.uid());
  return v_payment_id;
end $$;
revoke all on function public.register_fundraising_payment(uuid,uuid,numeric,date) from public, anon;
grant execute on function public.register_fundraising_payment(uuid,uuid,numeric,date) to authenticated;

create or replace function public.void_fundraising_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.fundraising_payments%rowtype;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Debe indicar el motivo.'; end if;
  select * into v_payment from public.fundraising_payments
  where id=p_payment_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  if v_payment.status='voided' then raise exception 'El pago ya esta anulado.'; end if;
  update public.fundraising_payments set status='voided',void_reason=p_reason,updated_by=auth.uid(),updated_at=now()
  where id=p_payment_id;
  update public.treasury_transactions set status='voided',void_reason=p_reason,updated_by=auth.uid(),updated_at=now()
  where fundraising_payment_id=p_payment_id;
  insert into public.treasury_audit(parish_id,payment_id,action,old_values,new_values,performed_by)
  select parish_id,id,'payment_voided',jsonb_build_object('status','active'),
         jsonb_build_object('status','voided','reason',p_reason),auth.uid()
  from public.fundraising_payments where id=p_payment_id;
end $$;
revoke all on function public.void_fundraising_payment(uuid,text) from public, anon;
grant execute on function public.void_fundraising_payment(uuid,text) to authenticated;

create or replace function public.create_treasury_transaction(
  p_transaction_date date,
  p_description text,
  p_transaction_type text,
  p_amount numeric,
  p_category text,
  p_event_id uuid default null,
  p_observations text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_description is null or btrim(p_description)='' then raise exception 'La descripcion es requerida.'; end if;
  if p_transaction_type not in ('entrada','salida') then raise exception 'Tipo invalido.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'El importe no puede ser negativo.'; end if;
  if p_category not in ('donacion','aportacion','venta','gasto','retiro','otro') then raise exception 'Categoria invalida.'; end if;
  if p_event_id is not null and not exists (
    select 1 from public.fundraising_events where id=p_event_id and parish_id=public.current_parish()
  ) then raise exception 'Evento no encontrado.'; end if;
  insert into public.treasury_transactions(
    parish_id,transaction_date,description,transaction_type,amount,category,
    fundraising_event_id,observations,created_by,updated_by
  ) values (
    public.current_parish(),coalesce(p_transaction_date,(now() at time zone 'America/Tijuana')::date),
    btrim(p_description),p_transaction_type,p_amount,p_category,p_event_id,p_observations,auth.uid(),auth.uid()
  ) returning id into v_id;
  insert into public.treasury_audit(parish_id,transaction_id,action,new_values,performed_by)
  values (public.current_parish(),v_id,'transaction_created',
          jsonb_build_object('amount',p_amount,'type',p_transaction_type,'description',p_description),auth.uid());
  return v_id;
end $$;
revoke all on function public.create_treasury_transaction(date,text,text,numeric,text,uuid,text) from public, anon;
grant execute on function public.create_treasury_transaction(date,text,text,numeric,text,uuid,text) to authenticated;

create or replace function public.update_treasury_transaction(
  p_transaction_id uuid,
  p_transaction_date date,
  p_description text,
  p_transaction_type text,
  p_amount numeric,
  p_category text,
  p_event_id uuid default null,
  p_observations text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_transaction public.treasury_transactions%rowtype;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_description is null or btrim(p_description)='' then raise exception 'La descripcion es requerida.'; end if;
  if p_transaction_type not in ('entrada','salida') then raise exception 'Tipo invalido.'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 9999999999.99 then raise exception 'Importe invalido.'; end if;
  if p_category not in ('donacion','aportacion','venta','gasto','retiro','otro') then raise exception 'Categoria invalida.'; end if;
  select * into v_transaction from public.treasury_transactions
  where id=p_transaction_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if v_transaction.status<>'active' then raise exception 'No se puede editar un movimiento anulado.'; end if;
  if v_transaction.fundraising_payment_id is not null then
    raise exception 'Las aportaciones se editan desde Aportaciones y cobros.';
  end if;
  if p_event_id is not null and not exists(
    select 1 from public.fundraising_events where id=p_event_id and parish_id=public.current_parish()
  ) then raise exception 'Evento no encontrado.'; end if;
  update public.treasury_transactions set
    transaction_date=coalesce(p_transaction_date,transaction_date),
    description=btrim(p_description),transaction_type=p_transaction_type,amount=p_amount,
    category=p_category,fundraising_event_id=p_event_id,observations=p_observations,
    updated_by=auth.uid(),updated_at=now()
  where id=p_transaction_id;
  insert into public.treasury_audit(parish_id,transaction_id,action,old_values,new_values,performed_by)
  values(v_transaction.parish_id,p_transaction_id,'transaction_updated',
    jsonb_build_object('transaction_date',v_transaction.transaction_date,'description',v_transaction.description,
      'transaction_type',v_transaction.transaction_type,'amount',v_transaction.amount,'category',v_transaction.category,
      'fundraising_event_id',v_transaction.fundraising_event_id,'observations',v_transaction.observations),
    jsonb_build_object('transaction_date',coalesce(p_transaction_date,v_transaction.transaction_date),
      'description',btrim(p_description),'transaction_type',p_transaction_type,'amount',p_amount,
      'category',p_category,'fundraising_event_id',p_event_id,'observations',p_observations),auth.uid());
end $$;
revoke all on function public.update_treasury_transaction(uuid,date,text,text,numeric,text,uuid,text) from public, anon;
grant execute on function public.update_treasury_transaction(uuid,date,text,text,numeric,text,uuid,text) to authenticated;

create or replace function public.void_treasury_transaction(p_transaction_id uuid,p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_transaction public.treasury_transactions%rowtype;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_reason is null or btrim(p_reason)='' then raise exception 'Debe indicar el motivo.'; end if;
  select * into v_transaction from public.treasury_transactions
  where id=p_transaction_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if v_transaction.status='voided' then raise exception 'El movimiento ya esta anulado.'; end if;
  if v_transaction.fundraising_payment_id is not null then
    perform public.void_fundraising_payment(v_transaction.fundraising_payment_id,p_reason);
    return;
  end if;
  update public.treasury_transactions set status='voided',void_reason=p_reason,updated_by=auth.uid(),updated_at=now()
  where id=p_transaction_id;
  insert into public.treasury_audit(parish_id,transaction_id,action,old_values,new_values,performed_by)
  values (v_transaction.parish_id,p_transaction_id,'transaction_voided',
          jsonb_build_object('status','active'),jsonb_build_object('status','voided','reason',p_reason),auth.uid());
end $$;
revoke all on function public.void_treasury_transaction(uuid,text) from public, anon;
grant execute on function public.void_treasury_transaction(uuid,text) to authenticated;

create or replace function public.create_fundraising_event(
  p_name text,
  p_description text,
  p_deadline date,
  p_suggested_amount numeric,
  p_server_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_event_id uuid; v_server_id uuid;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'El nombre es requerido.'; end if;
  if p_suggested_amount is null or p_suggested_amount<0 then raise exception 'Monto invalido.'; end if;
  insert into public.fundraising_events(parish_id,name,description,deadline,suggested_amount,created_by,updated_by)
  values (public.current_parish(),btrim(p_name),p_description,p_deadline,p_suggested_amount,auth.uid(),auth.uid())
  returning id into v_event_id;
  foreach v_server_id in array coalesce(p_server_ids,'{}'::uuid[]) loop
    if exists(select 1 from public.people where id=v_server_id and parish_id=public.current_parish()) then
      insert into public.fundraising_participants(event_id,server_id,required_amount)
      values(v_event_id,v_server_id,p_suggested_amount)
      on conflict(event_id,server_id) do nothing;
    end if;
  end loop;
  return v_event_id;
end $$;
revoke all on function public.create_fundraising_event(text,text,date,numeric,uuid[]) from public, anon;
grant execute on function public.create_fundraising_event(text,text,date,numeric,uuid[]) to authenticated;

create or replace function public.update_fundraising_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_paid_at date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.fundraising_payments%rowtype;
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_amount is null or p_amount<=0 or p_amount>9999999999.99 then raise exception 'Importe invalido.'; end if;
  select * into v_payment from public.fundraising_payments
  where id=p_payment_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  if v_payment.status<>'active' then raise exception 'No se puede editar un pago anulado.'; end if;
  update public.fundraising_payments set amount=p_amount,paid_at=coalesce(p_paid_at,paid_at),
    updated_by=auth.uid(),updated_at=now() where id=p_payment_id;
  update public.treasury_transactions set amount=p_amount,
    transaction_date=coalesce(p_paid_at,transaction_date),updated_by=auth.uid(),updated_at=now()
  where fundraising_payment_id=p_payment_id and status='active';
  insert into public.treasury_audit(parish_id,payment_id,transaction_id,action,old_values,new_values,performed_by)
  select v_payment.parish_id,p_payment_id,t.id,'payment_updated',
    jsonb_build_object('amount',v_payment.amount,'paid_at',v_payment.paid_at),
    jsonb_build_object('amount',p_amount,'paid_at',coalesce(p_paid_at,v_payment.paid_at)),auth.uid()
  from public.treasury_transactions t where t.fundraising_payment_id=p_payment_id;
end $$;
revoke all on function public.update_fundraising_payment(uuid,numeric,date) from public, anon;
grant execute on function public.update_fundraising_payment(uuid,numeric,date) to authenticated;

create or replace function public.set_fundraising_event_status(p_event_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_treasury() then raise exception 'No autorizado.'; end if;
  if p_status not in ('active','finished','cancelled') then raise exception 'Estado invalido.'; end if;
  update public.fundraising_events set status=p_status,updated_by=auth.uid(),updated_at=now()
  where id=p_event_id and parish_id=public.current_parish();
  if not found then raise exception 'Evento no encontrado.'; end if;
end $$;
revoke all on function public.set_fundraising_event_status(uuid,text) from public, anon;
grant execute on function public.set_fundraising_event_status(uuid,text) to authenticated;

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
  if v_activity.capture_status='closed' then raise exception 'La captura ya fue cerrada.'; end if;
  insert into public.attendance_records(activity_id,server_id,status,marked_by,marked_at)
  values (p_activity_id,p_server_id,case when p_present then 'present' else 'absent' end,auth.uid(),now())
  on conflict(activity_id,server_id) do update set
    status=excluded.status,marked_by=excluded.marked_by,marked_at=excluded.marked_at,updated_at=now();
  return case when p_present then 'present' else 'absent' end;
end $$;
revoke all on function public.toggle_attendance(uuid,uuid,boolean) from public, anon;
grant execute on function public.toggle_attendance(uuid,uuid,boolean) to authenticated;

create or replace function public.close_attendance_capture(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_attendance() then raise exception 'No autorizado.'; end if;
  update public.community_activities set capture_status='closed',status='completed',updated_by=auth.uid(),updated_at=now()
  where id=p_activity_id and parish_id=public.current_parish();
  if not found then raise exception 'Actividad no encontrada.'; end if;
  insert into public.attendance_records(activity_id,server_id,status,marked_by,marked_at)
  select ap.activity_id,ap.server_id,'absent',auth.uid(),now()
  from public.activity_participants ap
  join public.community_activities ca on ca.id=ap.activity_id
  where ap.activity_id=p_activity_id and ca.parish_id=public.current_parish()
  on conflict(activity_id,server_id) do update set
    status=case when attendance_records.status='present' then 'present' else 'absent' end,
    marked_by=excluded.marked_by,marked_at=excluded.marked_at,updated_at=now();
end $$;
revoke all on function public.close_attendance_capture(uuid) from public, anon;
grant execute on function public.close_attendance_capture(uuid) to authenticated;

alter table public.treasury_transactions enable row level security;
alter table public.fundraising_events enable row level security;
alter table public.fundraising_participants enable row level security;
alter table public.fundraising_payments enable row level security;
alter table public.treasury_audit enable row level security;
alter table public.activity_types enable row level security;
alter table public.community_activities enable row level security;
alter table public.activity_participants enable row level security;
alter table public.attendance_records enable row level security;
alter table public.activity_recurrences enable row level security;

create policy "parish reads treasury" on public.treasury_transactions for select to authenticated
using (parish_id=public.current_parish() and public.can_manage_treasury());
create policy "parish reads fundraising" on public.fundraising_events for select to authenticated
using (parish_id=public.current_parish() and public.can_manage_treasury());
create policy "linked server reads own fundraising events" on public.fundraising_events for select to authenticated
using (parish_id=public.current_parish() and exists(
  select 1 from public.fundraising_participants fp
  where fp.event_id=fundraising_events.id and app_private.is_linked_server(fp.server_id)
));
create policy "parish reads participants" on public.fundraising_participants for select to authenticated
using (exists(select 1 from public.profiles pr where pr.id=auth.uid() and pr.person_id=server_id));
create policy "parish reads payments" on public.fundraising_payments for select to authenticated
using (parish_id=public.current_parish() and public.can_manage_treasury());
create policy "linked server reads own payments" on public.fundraising_payments for select to authenticated
using (parish_id=public.current_parish() and app_private.is_linked_server(server_id));
create policy "treasury audit read" on public.treasury_audit for select to authenticated
using (parish_id=public.current_parish() and public.can_manage_treasury());

create policy "activity types read" on public.activity_types for select to authenticated
using (parish_id=public.current_parish());
create policy "activity types admin manage" on public.activity_types for all to authenticated
using (parish_id=public.current_parish() and public.current_user_role()::text='ADMIN')
with check (parish_id=public.current_parish() and public.current_user_role()::text='ADMIN');
create policy "activities parish read" on public.community_activities for select to authenticated
using (parish_id=public.current_parish() and (
  public.can_manage_attendance() or app_private.is_linked_activity_participant(community_activities.id,community_activities.parish_id)
));
create policy "activities staff manage" on public.community_activities for all to authenticated
using (parish_id=public.current_parish() and public.can_manage_attendance())
with check (parish_id=public.current_parish() and public.can_manage_attendance());
create policy "activity participants parish read" on public.activity_participants for select to authenticated
using (app_private.is_linked_server(server_id));
create policy "activity participants staff manage" on public.activity_participants for all to authenticated
using (exists(select 1 from public.community_activities a where a.id=activity_id and a.parish_id=public.current_parish()) and public.can_manage_attendance())
with check (exists(select 1 from public.community_activities a where a.id=activity_id and a.parish_id=public.current_parish()) and public.can_manage_attendance());
create policy "attendance parish read" on public.attendance_records for select to authenticated
using (app_private.is_linked_server(server_id));
create policy "attendance staff manage" on public.attendance_records for all to authenticated
using (exists(select 1 from public.community_activities a where a.id=activity_id and a.parish_id=public.current_parish()) and public.can_manage_attendance())
with check (exists(select 1 from public.community_activities a where a.id=activity_id and a.parish_id=public.current_parish()) and public.can_manage_attendance());
create policy "recurrences staff manage" on public.activity_recurrences for all to authenticated
using (parish_id=public.current_parish() and public.can_manage_attendance())
with check (parish_id=public.current_parish() and public.can_manage_attendance());

create policy "linked server reads own person" on public.people for select to authenticated
using (id=(select person_id from public.profiles where id=auth.uid()));
