alter table public.profiles
  add column phone_contact text,
  add column phone_verified_at timestamptz;

alter table public.profiles
  add constraint profiles_phone_contact_e164
  check (phone_contact is null or phone_contact ~ '^\+52[0-9]{10}$');

create table public.app_permission_catalog (
  permission_key text primary key,
  description text not null
);

insert into public.app_permission_catalog(permission_key,description) values
  ('portal.view','Consultar el portal personal'),
  ('commissions.view_own','Consultar comisiones propias'),
  ('commissions.manage','Crear, asignar y administrar comisiones'),
  ('notices.view','Consultar avisos dirigidos'),
  ('notices.manage','Crear y administrar avisos'),
  ('attendance.view_own','Consultar asistencias propias'),
  ('attendance.view_all','Consultar asistencias de todos'),
  ('attendance.manage','Crear actividades y capturar asistencias'),
  ('treasury.view_own_contributions','Consultar aportaciones propias'),
  ('treasury.view','Consultar Tesorería'),
  ('treasury.manage','Administrar movimientos y aportaciones'),
  ('treasury.export','Exportar reportes de Tesorería'),
  ('users.manage_permissions','Administrar permisos de usuarios')
on conflict (permission_key) do nothing;

create table public.profile_permission_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.app_permission_catalog(permission_key) on delete restrict,
  allowed boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(profile_id,permission_key)
);

create table public.permission_audit (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete restrict,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  permission_key text not null references public.app_permission_catalog(permission_key),
  old_allowed boolean,
  new_allowed boolean,
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 180),
  description text not null check (length(btrim(description)) between 1 and 10000),
  published_at timestamptz,
  expires_at timestamptz,
  activity_id uuid references public.community_activities(id) on delete set null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  audience_type text not null default 'all' check (audience_type in ('all','class','selected')),
  audience_class_id text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((audience_type='class' and audience_class_id is not null) or (audience_type<>'class' and audience_class_id is null)),
  check (expires_at is null or published_at is null or expires_at > published_at)
);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(announcement_id,person_id)
);

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(announcement_id,profile_id)
);

create index profile_permission_lookup_idx on public.profile_permission_overrides(profile_id,permission_key);
create index announcements_parish_status_idx on public.announcements(parish_id,status,published_at desc);
create index announcement_recipients_person_idx on public.announcement_recipients(person_id,announcement_id);
create index announcement_reads_profile_idx on public.announcement_reads(profile_id,read_at desc);

create or replace function public.has_app_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_person_id uuid;
  v_override boolean;
  v_default boolean := false;
begin
  select role::text,person_id into v_role,v_person_id
  from public.profiles where id=auth.uid() and active and parish_id is not null;
  if not found or not exists(select 1 from public.app_permission_catalog where permission_key=p_permission) then
    return false;
  end if;

  if v_role='ADMIN' then return true; end if;

  select allowed into v_override from public.profile_permission_overrides
  where profile_id=auth.uid() and permission_key=p_permission;
  if found then
    return v_override;
  end if;

  if p_permission='commissions.view_own' then
    return (v_person_id is not null and v_role in ('SERVIDOR','LECTOR','COORDINADOR','COORDINADOR_LITURGIA','TESORERO'))
      or v_role in ('COORDINADOR','COORDINADOR_LITURGIA')
      or exists(select 1 from public.profile_permission_overrides where profile_id=auth.uid()
        and permission_key='commissions.manage' and allowed);
  end if;

  if p_permission='portal.view' then
    return v_role='SERVIDOR' or (v_person_id is not null and v_role in ('LECTOR','COORDINADOR','COORDINADOR_LITURGIA','TESORERO'));
  end if;

  if p_permission in ('attendance.view_own','treasury.view_own_contributions') then
    return v_person_id is not null and v_role in ('SERVIDOR','LECTOR','COORDINADOR','COORDINADOR_LITURGIA','TESORERO');
  end if;

  if p_permission='commissions.manage' then v_default:=v_role in ('COORDINADOR','COORDINADOR_LITURGIA'); end if;
  if p_permission='notices.manage' then v_default:=v_role in ('COORDINADOR','COORDINADOR_LITURGIA'); end if;
  if p_permission='attendance.view_all' then v_default:=v_role in ('ADMIN','COORDINADOR','COORDINADOR_LITURGIA'); end if;
  if p_permission='attendance.manage' then v_default:=v_role in ('ADMIN','COORDINADOR','COORDINADOR_LITURGIA'); end if;
  if p_permission='treasury.view' then v_default:=v_role='TESORERO' or exists(
    select 1 from public.profile_permission_overrides where profile_id=auth.uid()
      and permission_key='treasury.manage' and allowed
  ); end if;
  if p_permission='treasury.manage' then v_default:=v_role='TESORERO'; end if;
  if p_permission='treasury.export' then v_default:=v_role='TESORERO'; end if;
  if p_permission='notices.view' then v_default:=v_role in ('COORDINADOR','COORDINADOR_LITURGIA','TESORERO')
    or (v_person_id is not null and v_role in ('SERVIDOR','LECTOR')); end if;
  if p_permission='attendance.view_all' then v_default:=v_default or exists(
    select 1 from public.profile_permission_overrides where profile_id=auth.uid()
      and permission_key='attendance.manage' and allowed
  ); end if;
  return v_default;
end $$;
revoke all on function public.has_app_permission(text) from public,anon;
grant execute on function public.has_app_permission(text) to authenticated,service_role;

create or replace function public.is_current_portal_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.active and p.person_id=p_person_id
      and p.parish_id=public.current_parish()
  );
$$;

create or replace function public.is_current_person_assigned_to_mass(p_mass_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.mass_assignments ma join public.profiles pr on pr.person_id=ma.person_id
    where ma.mass_id=p_mass_id and pr.id=auth.uid() and pr.active);
$$;
create or replace function public.is_current_person_activity_participant(p_activity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.activity_participants ap join public.profiles pr on pr.person_id=ap.server_id
    where ap.activity_id=p_activity_id and pr.id=auth.uid() and pr.active);
$$;
create or replace function public.is_current_person_fundraising_participant(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.fundraising_participants fp join public.profiles pr on pr.person_id=fp.server_id
    where fp.event_id=p_event_id and pr.id=auth.uid() and pr.active);
$$;
create or replace function public.is_current_parish_activity(p_activity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.community_activities where id=p_activity_id and parish_id=public.current_parish());
$$;
create or replace function public.is_current_parish_fundraising_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.fundraising_events where id=p_event_id and parish_id=public.current_parish());
$$;
revoke all on function public.is_current_person_assigned_to_mass(uuid),public.is_current_person_activity_participant(uuid),
  public.is_current_person_fundraising_participant(uuid),public.is_current_parish_activity(uuid),
  public.is_current_parish_fundraising_event(uuid) from public,anon;
grant execute on function public.is_current_person_assigned_to_mass(uuid),public.is_current_person_activity_participant(uuid),
  public.is_current_person_fundraising_participant(uuid),public.is_current_parish_activity(uuid),
  public.is_current_parish_fundraising_event(uuid) to authenticated,service_role;

create or replace function public.can_manage_treasury()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_app_permission('treasury.manage');
$$;
create or replace function public.can_manage_attendance()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_app_permission('attendance.manage');
$$;
create or replace function public.can_manage_commissions()
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.has_app_permission('commissions.manage');
$$;
revoke all on function public.can_manage_treasury(),public.can_manage_attendance(),public.can_manage_commissions() from public,anon;
grant execute on function public.can_manage_treasury(),public.can_manage_attendance(),public.can_manage_commissions() to authenticated,service_role;
revoke all on function public.is_current_portal_person(uuid) from public,anon;
grant execute on function public.is_current_portal_person(uuid) to authenticated,service_role;

create or replace function public.is_current_announcement_recipient(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_app_permission('notices.view') and exists(
    select 1
    from public.announcements a
    join public.profiles pr on pr.id=auth.uid() and pr.active and pr.parish_id=a.parish_id
    left join public.people pe on pe.id=pr.person_id
    where a.id=p_announcement_id
      and a.status='published'
      and (a.expires_at is null or a.expires_at>now())
      and (
        a.audience_type='all'
        or (a.audience_type='class' and pe.class_id=a.audience_class_id)
        or (a.audience_type='selected' and exists(
          select 1 from public.announcement_recipients ar
          where ar.announcement_id=a.id and ar.person_id=pr.person_id
        ))
      )
  );
$$;
revoke all on function public.is_current_announcement_recipient(uuid) from public,anon;
grant execute on function public.is_current_announcement_recipient(uuid) to authenticated,service_role;

create or replace function public.set_profile_permission_overrides(
  p_profile_id uuid,
  p_overrides jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_entry jsonb;
  v_key text;
  v_allowed boolean;
  v_old boolean;
begin
  if not public.has_app_permission('users.manage_permissions') then raise exception 'No autorizado.'; end if;
  if p_profile_id=auth.uid() then raise exception 'No puedes modificar tus propios permisos.'; end if;
  select * into v_target from public.profiles
  where id=p_profile_id and parish_id=public.current_parish() for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if jsonb_typeof(p_overrides)<>'array' then raise exception 'Formato de permisos invalido.'; end if;

  for v_entry in select value from jsonb_array_elements(p_overrides) loop
    v_key:=v_entry->>'permission_key';
    if jsonb_typeof(v_entry->'allowed')<>'boolean' or not exists(
      select 1 from public.app_permission_catalog where permission_key=v_key
    ) then raise exception 'Permiso invalido.'; end if;
  end loop;

  for v_key in select permission_key from public.app_permission_catalog loop
    select allowed into v_old from public.profile_permission_overrides
      where profile_id=p_profile_id and permission_key=v_key;
    if found then
      if not exists(select 1 from jsonb_array_elements(p_overrides) e where e->>'permission_key'=v_key) then
        insert into public.permission_audit(parish_id,target_profile_id,actor_profile_id,permission_key,old_allowed,new_allowed)
        values(v_target.parish_id,p_profile_id,auth.uid(),v_key,v_old,null);
        delete from public.profile_permission_overrides where profile_id=p_profile_id and permission_key=v_key;
      else
        select (e->>'allowed')::boolean into v_allowed
        from jsonb_array_elements(p_overrides) e where e->>'permission_key'=v_key;
        if v_allowed is distinct from v_old then
          insert into public.permission_audit(parish_id,target_profile_id,actor_profile_id,permission_key,old_allowed,new_allowed)
          values(v_target.parish_id,p_profile_id,auth.uid(),v_key,v_old,v_allowed);
        end if;
        update public.profile_permission_overrides set allowed=v_allowed,updated_by=auth.uid(),updated_at=now()
        where profile_id=p_profile_id and permission_key=v_key;
      end if;
    else
      select (e->>'allowed')::boolean into v_allowed
      from jsonb_array_elements(p_overrides) e where e->>'permission_key'=v_key;
      if found then
        insert into public.profile_permission_overrides(profile_id,permission_key,allowed,updated_by)
        values(p_profile_id,v_key,v_allowed,auth.uid());
        insert into public.permission_audit(parish_id,target_profile_id,actor_profile_id,permission_key,old_allowed,new_allowed)
        values(v_target.parish_id,p_profile_id,auth.uid(),v_key,null,v_allowed);
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.set_profile_permission_overrides(uuid,jsonb) from public,anon;
grant execute on function public.set_profile_permission_overrides(uuid,jsonb) to authenticated;

create or replace function public.list_permission_profiles()
returns table(
  profile_id uuid,
  full_name text,
  role text,
  active boolean,
  permission_overrides jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,p.full_name,p.role::text,p.active,
    coalesce(jsonb_agg(jsonb_build_object('permission_key',po.permission_key,'allowed',po.allowed))
      filter(where po.permission_key is not null),'[]'::jsonb)
  from public.profiles p
  left join public.profile_permission_overrides po on po.profile_id=p.id
  where p.parish_id=public.current_parish() and p.id<>auth.uid()
    and public.has_app_permission('users.manage_permissions')
  group by p.id,p.full_name,p.role,p.active
  order by p.full_name,p.id;
$$;
revoke all on function public.list_permission_profiles() from public,anon;
grant execute on function public.list_permission_profiles() to authenticated;

create or replace function public.admin_update_app_user(
  p_profile_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_active boolean,
  p_person_id uuid,
  p_phone_contact text,
  p_permission_overrides jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role()::text<>'ADMIN' then raise exception 'No autorizado.'; end if;
  if p_profile_id=auth.uid() and p_permission_overrides is not null then
    raise exception 'No puedes modificar tus propios permisos.';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 150 then raise exception 'Nombre invalido.'; end if;
  if p_phone_contact is not null and p_phone_contact !~ '^\+52[0-9]{10}$' then raise exception 'Telefono invalido.'; end if;
  update public.profiles set full_name=btrim(p_full_name),role=p_role,active=p_active,
    person_id=p_person_id,phone_contact=p_phone_contact
  where id=p_profile_id and parish_id=public.current_parish();
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if p_permission_overrides is not null then
    perform public.set_profile_permission_overrides(p_profile_id,p_permission_overrides);
  end if;
  return p_profile_id;
end $$;
revoke all on function public.admin_update_app_user(uuid,text,public.user_role,boolean,uuid,text,jsonb) from public,anon;
grant execute on function public.admin_update_app_user(uuid,text,public.user_role,boolean,uuid,text,jsonb) to authenticated;

create or replace function public.create_announcement(
  p_title text,
  p_description text,
  p_expires_at timestamptz,
  p_activity_id uuid,
  p_priority text,
  p_audience_type text,
  p_audience_class_id text,
  p_person_ids uuid[],
  p_status text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_app_permission('notices.manage') then raise exception 'No autorizado.'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 180
     or p_description is null or length(btrim(p_description)) not between 1 and 10000 then
    raise exception 'Titulo o descripcion invalido.';
  end if;
  if p_priority not in ('low','normal','high','urgent')
     or p_audience_type not in ('all','class','selected')
     or p_status not in ('draft','published','archived') then
    raise exception 'Configuracion de aviso invalida.';
  end if;
  if p_audience_type='class' and not exists(
    select 1 from public.people where parish_id=public.current_parish() and class_id=p_audience_class_id
  ) then raise exception 'Clase no valida.'; end if;
  if p_audience_type='selected' and coalesce(cardinality(p_person_ids),0)=0 then
    raise exception 'Selecciona al menos un destinatario.'; end if;
  if p_status='published' and p_expires_at is not null and p_expires_at<=now() then
    raise exception 'La fecha de vencimiento debe ser futura.'; end if;
  if p_activity_id is not null and not exists(
    select 1 from public.community_activities where id=p_activity_id and parish_id=public.current_parish()
  ) then raise exception 'Actividad no disponible.'; end if;

  insert into public.announcements(
    parish_id,title,description,published_at,expires_at,activity_id,priority,
    audience_type,audience_class_id,status,created_by,updated_by
  ) values(
    public.current_parish(),btrim(p_title),btrim(p_description),
    case when p_status='published' then now() else null end,
    p_expires_at,p_activity_id,p_priority,p_audience_type,p_audience_class_id,p_status,auth.uid(),auth.uid()
  ) returning id into v_id;

  if p_audience_type='selected' then
    insert into public.announcement_recipients(announcement_id,person_id)
    select v_id,recipient.person_id
    from (select distinct unnest(p_person_ids) as person_id) recipient
    join public.people p on p.id=recipient.person_id and p.parish_id=public.current_parish()
    on conflict do nothing;
    if (select count(*) from public.announcement_recipients where announcement_id=v_id)<>(
      select count(distinct person_id) from unnest(p_person_ids) as recipient(person_id)
    ) then raise exception 'Uno o mas destinatarios no pertenecen a la parroquia.'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.create_announcement(text,text,timestamptz,uuid,text,text,text,uuid[],text) from public,anon;
grant execute on function public.create_announcement(text,text,timestamptz,uuid,text,text,text,uuid[],text) to authenticated;

create or replace function public.update_announcement(
  p_announcement_id uuid,
  p_title text,
  p_description text,
  p_expires_at timestamptz,
  p_activity_id uuid,
  p_priority text,
  p_audience_type text,
  p_audience_class_id text,
  p_person_ids uuid[],
  p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_app_permission('notices.manage') then raise exception 'No autorizado.'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 180
     or p_description is null or length(btrim(p_description)) not between 1 and 10000 then
    raise exception 'Titulo o descripcion invalido.';
  end if;
  if p_priority not in ('low','normal','high','urgent')
     or p_audience_type not in ('all','class','selected')
     or p_status not in ('draft','published','archived') then
    raise exception 'Configuracion de aviso invalida.';
  end if;
  if p_audience_type='class' and not exists(
    select 1 from public.people where parish_id=public.current_parish() and class_id=p_audience_class_id
  ) then raise exception 'Clase no valida.'; end if;
  if p_audience_type='selected' and coalesce(cardinality(p_person_ids),0)=0 then
    raise exception 'Selecciona al menos un destinatario.'; end if;
  if p_status='published' and p_expires_at is not null and p_expires_at<=now() then
    raise exception 'La fecha de vencimiento debe ser futura.'; end if;
  if p_activity_id is not null and not exists(
    select 1 from public.community_activities where id=p_activity_id and parish_id=public.current_parish()
  ) then raise exception 'Actividad no disponible.'; end if;
  update public.announcements set title=btrim(p_title),description=btrim(p_description),
    expires_at=p_expires_at,activity_id=p_activity_id,priority=p_priority,
    audience_type=p_audience_type,audience_class_id=p_audience_class_id,
    status=p_status,published_at=case when p_status='published' then coalesce(published_at,now()) else published_at end
  where id=p_announcement_id and parish_id=public.current_parish();
  if not found then raise exception 'Aviso no encontrado.'; end if;
  delete from public.announcement_recipients where announcement_id=p_announcement_id;
  if p_audience_type='selected' then
    insert into public.announcement_recipients(announcement_id,person_id)
    select p_announcement_id,recipient.person_id
    from unnest(p_person_ids) as recipient(person_id)
    join public.people p on p.id=recipient.person_id and p.parish_id=public.current_parish()
    on conflict do nothing;
    if (select count(*) from public.announcement_recipients where announcement_id=p_announcement_id)<>(
      select count(distinct person_id) from unnest(p_person_ids) as recipient(person_id)
    ) then raise exception 'Uno o mas destinatarios no pertenecen a la parroquia.'; end if;
  end if;
end $$;
revoke all on function public.update_announcement(uuid,text,text,timestamptz,uuid,text,text,text,uuid[],text) from public,anon;
grant execute on function public.update_announcement(uuid,text,text,timestamptz,uuid,text,text,text,uuid[],text) to authenticated;

create or replace function public.set_announcement_status(p_announcement_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_app_permission('notices.manage') then raise exception 'No autorizado.'; end if;
  if p_status not in ('draft','published','archived') then raise exception 'Estado invalido.'; end if;
  update public.announcements set status=p_status
  where id=p_announcement_id and parish_id=public.current_parish();
  if not found then raise exception 'Aviso no encontrado.'; end if;
end $$;
revoke all on function public.set_announcement_status(uuid,text) from public,anon;
grant execute on function public.set_announcement_status(uuid,text) to authenticated;

create or replace function public.update_announcement_timestamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='published' and new.expires_at is not null and new.expires_at<=now() then
    raise exception 'La fecha de vencimiento debe ser futura.';
  end if;
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  if new.status='published' and old.status<>'published' then new.published_at:=now(); end if;
  return new;
end $$;
create trigger announcements_update_timestamps before update on public.announcements
for each row execute function public.update_announcement_timestamps();

alter table public.app_permission_catalog enable row level security;
alter table public.profile_permission_overrides enable row level security;
alter table public.permission_audit enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.announcement_reads enable row level security;

create policy "authenticated read permission catalog" on public.app_permission_catalog
for select to authenticated using (public.current_user_role() is not null);
create policy "users read own permission overrides" on public.profile_permission_overrides
for select to authenticated using (profile_id=auth.uid() or (public.has_app_permission('users.manage_permissions') and exists(
  select 1 from public.profiles target where target.id=profile_id and target.parish_id=public.current_parish()
)));
create policy "active accounts permission overrides only" on public.profile_permission_overrides as restrictive
for select to authenticated using (public.current_user_role() is not null and public.current_parish() is not null);
create policy "users audit read permission changes" on public.permission_audit
for select to authenticated using (public.has_app_permission('users.manage_permissions') and parish_id=public.current_parish());

create policy "announcements recipient select" on public.announcements
for select to authenticated using (public.is_current_announcement_recipient(id));
create policy "announcements managers select" on public.announcements
for select to authenticated using (parish_id=public.current_parish() and public.has_app_permission('notices.manage'));

create policy "announcement recipients managers select" on public.announcement_recipients
for select to authenticated using (exists(select 1 from public.announcements a where a.id=announcement_id and a.parish_id=public.current_parish() and public.has_app_permission('notices.manage')));
create policy "announcement recipients own select" on public.announcement_recipients
for select to authenticated using (public.is_current_portal_person(person_id));

create policy "announcement reads own select" on public.announcement_reads
for select to authenticated using (profile_id=auth.uid() and public.has_app_permission('notices.view'));
create policy "announcement reads own insert" on public.announcement_reads
for insert to authenticated with check (profile_id=auth.uid() and public.is_current_announcement_recipient(announcement_id));
create policy "announcement reads own update" on public.announcement_reads
for update to authenticated using (profile_id=auth.uid() and public.is_current_announcement_recipient(announcement_id))
with check (profile_id=auth.uid() and public.is_current_announcement_recipient(announcement_id));

create policy "portal own confirmed commissions" on public.masses as restrictive for select to authenticated
using (
  public.current_user_role()::text<>'SERVIDOR'
  or public.has_app_permission('commissions.manage')
  or (
    status='published' and public.has_app_permission('commissions.view_own')
    and public.is_current_person_assigned_to_mass(masses.id)
  )
);
create policy "portal own assignment reads" on public.mass_assignments as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or public.has_app_permission('commissions.manage') or public.is_current_portal_person(person_id));

create policy "portal own people read" on public.people for select to authenticated
using (public.has_app_permission('portal.view') and public.is_current_portal_person(id));
create policy "portal people rows restricted" on public.people as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or (public.has_app_permission('portal.view') and public.is_current_portal_person(id))
  or public.has_app_permission('attendance.manage') or public.has_app_permission('treasury.view'));
create policy "portal own person services read" on public.person_services for select to authenticated
using (public.has_app_permission('portal.view') and public.is_current_portal_person(person_id));
create policy "portal person services rows restricted" on public.person_services as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or (public.has_app_permission('portal.view') and public.is_current_portal_person(person_id)));
create policy "portal availability rows restricted" on public.person_availability as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or (public.has_app_permission('portal.view') and exists(
  select 1 from public.people p where p.id=person_availability.person_id and public.is_current_portal_person(p.id)
)));

create policy "portal own activity read" on public.community_activities as restrictive for select to authenticated
using (
  public.current_user_role()::text<>'SERVIDOR'
  or public.has_app_permission('attendance.view_all')
  or public.has_app_permission('attendance.manage')
  or (public.has_app_permission('attendance.view_own') and public.is_current_person_activity_participant(community_activities.id))
);
create policy "portal own participant read" on public.activity_participants as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or public.has_app_permission('attendance.view_all')
  or public.has_app_permission('attendance.manage') or public.is_current_portal_person(server_id));
create policy "portal own attendance read" on public.attendance_records as restrictive for select to authenticated
using (
  public.current_user_role()::text<>'SERVIDOR'
  or public.has_app_permission('attendance.view_all')
  or public.has_app_permission('attendance.manage')
  or (public.has_app_permission('attendance.view_own') and public.is_current_portal_person(server_id))
);

create policy "portal own events read" on public.fundraising_events as restrictive for select to authenticated
using (
  public.current_user_role()::text<>'SERVIDOR'
  or public.has_app_permission('treasury.view')
  or (public.has_app_permission('treasury.view_own_contributions') and public.is_current_person_fundraising_participant(fundraising_events.id))
);
create policy "portal own participants read" on public.fundraising_participants as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or public.has_app_permission('treasury.view')
  or (public.has_app_permission('treasury.view_own_contributions') and public.is_current_portal_person(server_id)));
create policy "portal own payments read" on public.fundraising_payments as restrictive for select to authenticated
using (public.current_user_role()::text<>'SERVIDOR' or public.has_app_permission('treasury.view')
  or (public.has_app_permission('treasury.view_own_contributions') and public.is_current_portal_person(server_id)));

create policy "treasury permission reads transactions" on public.treasury_transactions for select to authenticated
using (parish_id=public.current_parish() and public.has_app_permission('treasury.view'));
create policy "treasury permission reads events" on public.fundraising_events for select to authenticated
using (parish_id=public.current_parish() and public.has_app_permission('treasury.view'));
create policy "treasury permission reads participants" on public.fundraising_participants for select to authenticated
using (public.is_current_parish_fundraising_event(event_id)
  and public.has_app_permission('treasury.view'));
create policy "treasury permission reads payments" on public.fundraising_payments for select to authenticated
using (parish_id=public.current_parish() and public.has_app_permission('treasury.view'));
create policy "treasury permission reads audit" on public.treasury_audit for select to authenticated
using (parish_id=public.current_parish() and public.has_app_permission('treasury.view'));
create policy "attendance permission reads activities" on public.community_activities for select to authenticated
using (parish_id=public.current_parish() and public.has_app_permission('attendance.view_all'));
create policy "attendance permission reads participants" on public.activity_participants for select to authenticated
using (public.is_current_parish_activity(activity_id)
  and public.has_app_permission('attendance.view_all'));
create policy "attendance permission reads records" on public.attendance_records for select to authenticated
using (public.is_current_parish_activity(activity_id)
  and public.has_app_permission('attendance.view_all'));
