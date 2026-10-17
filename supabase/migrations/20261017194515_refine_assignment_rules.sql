-- Add links without rewriting or deleting any historical assignment.
-- Legacy mass cleaning is read by the UI and moves on the next explicit save.
alter table public.cleaning_assignments add column if not exists mass_id uuid references public.masses(id) on delete cascade;
alter table public.cleaning_assignments add column if not exists service_id uuid references public.services(id) on delete restrict;
alter table public.cleaning_assignments add column if not exists display_order integer not null default 0;
create index if not exists cleaning_assignments_mass_idx on public.cleaning_assignments(mass_id);

-- Readers could already see these rows when they lived in mass_assignments.
-- Expose only linked commission cleaning within their own parish, not standalone cleaning.
create policy "read commission cleaning in own parish"
on public.cleaning_assignments for select to authenticated
using (mass_id is not null and parish_id = public.current_parish()
  and exists (select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish()));

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
  if not public.is_staff() then
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
