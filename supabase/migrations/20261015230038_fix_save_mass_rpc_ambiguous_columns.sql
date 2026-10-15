drop function if exists public.save_mass_with_assignments(
  uuid, uuid, date, uuid, text, text, text, public.mass_status, text, text,
  text, text, text, jsonb
);

create function public.save_mass_with_assignments(
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
  from jsonb_array_elements(p_assignments) as item(value);

  return v_saved_id;
end;

$$;
