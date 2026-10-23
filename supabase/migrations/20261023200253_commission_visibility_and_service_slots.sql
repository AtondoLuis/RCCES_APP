alter table public.services add column required_servers integer not null default 1;
alter table public.services add constraint services_required_servers_positive check (required_servers >= 1);
-- Use stable identities first; names are a migration-only fallback for legacy catalogs.
update public.services set required_servers = 4
where trim(both '-' from lower(regexp_replace(coalesce(nullif(stable_key,''), nullif(slug,''), name), '[^a-zA-Z0-9]+', '-', 'g'))) = 'colecta';
update public.services set required_servers = 2
where trim(both '-' from lower(regexp_replace(coalesce(nullif(stable_key,''), nullif(slug,''), name), '[^a-zA-Z0-9]+', '-', 'g'))) in ('ofrenda','ofrenda-pan-vino','ofrenda-pan-y-vino');
-- Cleaning keeps its independently configured current slots. Bienvenida remains fixed text.

-- Do not broaden is_staff(): it grants writes to people and other non-liturgical data.
create function public.can_manage_commissions() returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(public.current_user_role()::text in ('ADMIN','COORDINADOR','COORDINADOR_LITURGIA'), false);
$$;
revoke all on function public.can_manage_commissions() from public, anon;
grant execute on function public.can_manage_commissions() to authenticated, service_role;

create policy "commission editors manage masses" on public.masses for all to authenticated
using (parish_id = public.current_parish() and public.can_manage_commissions() and (public.is_staff() or status <> 'finished'))
with check (parish_id = public.current_parish() and public.can_manage_commissions() and (public.is_staff() or status <> 'finished'));
create policy "commission editors manage assignments" on public.mass_assignments for all to authenticated
using (public.can_manage_commissions() and exists(select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish() and (public.is_staff() or m.status <> 'finished')))
with check (public.can_manage_commissions() and exists(select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish() and (public.is_staff() or m.status <> 'finished')));
create policy "commission editors manage linked cleaning" on public.cleaning_assignments for all to authenticated
using (parish_id = public.current_parish() and public.can_manage_commissions() and exists(select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish() and (public.is_staff() or m.status <> 'finished')))
with check (parish_id = public.current_parish() and public.can_manage_commissions() and exists(select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish() and (public.is_staff() or m.status <> 'finished')));

create policy "lectors see confirmed commissions only" on public.masses as restrictive for select to authenticated
using (public.current_user_role()::text <> 'LECTOR' or status = 'published');
-- Assignment policies inherit mass visibility; make the same condition explicit for cleaning.
create policy "lectors see confirmed cleaning only" on public.cleaning_assignments as restrictive for select to authenticated
using (public.current_user_role()::text <> 'LECTOR' or exists(select 1 from public.masses m where m.id = mass_id and m.status = 'published' and m.parish_id = public.current_parish()));

-- Protect linked people even for direct Data API writes, not just the form/RPC.
create policy "assignment people stay in parish" on public.mass_assignments as restrictive for all to authenticated
using (exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()))
with check (exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()));
create policy "cleaning people stay in parish" on public.cleaning_assignments as restrictive for all to authenticated
using (parish_id = public.current_parish() and exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()))
with check (parish_id = public.current_parish() and exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()));

create or replace function public.save_mass_with_assignments(
  p_mass_id uuid,
  p_parish_id uuid,
  p_mass_date date,
  p_mass_time_id uuid,
  p_title text,
  p_subtitle text,
  p_liturgical_cycle text,
  p_status public.mass_status,
  p_liturgical_text_title text,
  p_liturgical_text text,
  p_liturgical_text_reference text,
  p_image_url text,
  p_notes text,
  p_assignments jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved_id uuid;
begin
  if not public.can_manage_commissions() then
    raise exception 'No autorizado';
  end if;

  insert into public.masses as m (
    id,
    parish_id,
    mass_date,
    mass_time_id,
    title,
    subtitle,
    liturgical_cycle,
    status,
    liturgical_text_title,
    liturgical_text,
    liturgical_text_reference,
    image_url,
    notes,
    created_by,
    updated_at
  ) values (
    coalesce(p_mass_id, gen_random_uuid()),
    p_parish_id,
    p_mass_date,
    p_mass_time_id,
    p_title,
    p_subtitle,
    p_liturgical_cycle,
    p_status,
    p_liturgical_text_title,
    p_liturgical_text,
    p_liturgical_text_reference,
    p_image_url,
    p_notes,
    auth.uid(),
    now()
  )
  on conflict (parish_id, mass_date, mass_time_id) do update
  set
    title = excluded.title,
    subtitle = excluded.subtitle,
    liturgical_cycle = excluded.liturgical_cycle,
    status = excluded.status,
    liturgical_text_title = excluded.liturgical_text_title,
    liturgical_text = excluded.liturgical_text,
    liturgical_text_reference = excluded.liturgical_text_reference,
    image_url = excluded.image_url,
    notes = excluded.notes,
    updated_at = now()
  returning m.id into v_saved_id;

  delete from public.mass_assignments as ma
  where ma.mass_id = v_saved_id;

  insert into public.mass_assignments as ma (mass_id, service_id, person_id, display_order)
  select
    v_saved_id,
    (item.value ->> 'service_id')::uuid,
    (item.value ->> 'person_id')::uuid,
    coalesce((item.value ->> 'display_order')::int, 0)
  from jsonb_array_elements(p_assignments) as item(value)
  join public.services s on s.id = (item.value ->> 'service_id')::uuid
  where coalesce(s.stable_key, s.slug, '') <> 'bienvenida'
    and coalesce(s.stable_key, s.slug, '') not like 'limpieza%';

  -- Replace only this commission's cleaning as part of its explicit save.
  delete from public.cleaning_assignments where mass_id = v_saved_id;
  insert into public.cleaning_assignments (parish_id, cleaning_date, gender_group, person_id, mass_id, service_id, display_order)
  select p_parish_id, p_mass_date, coalesce(s.stable_key, s.slug),
    (item.value ->> 'person_id')::uuid, v_saved_id, s.id,
    coalesce((item.value ->> 'display_order')::int, 0)
  from jsonb_array_elements(p_assignments) as item(value)
  join public.services s on s.id = (item.value ->> 'service_id')::uuid
  where coalesce(s.stable_key, s.slug, '') like 'limpieza%';

  return v_saved_id;
end;

$$;
