create or replace function public.save_mass_with_assignments(
  mass_id uuid,
  parish_id uuid,
  mass_date date,
  mass_time_id uuid,
  title text,
  subtitle text,
  liturgical_cycle text,
  status public.mass_status,
  liturgical_text_title text,
  liturgical_text text,
  liturgical_text_reference text,
  image_url text,
  notes text,
  assignments jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare saved_id uuid;
begin
  if not public.is_staff() then raise exception 'No autorizado'; end if;
  insert into public.masses (id, parish_id, mass_date, mass_time_id, title, subtitle, liturgical_cycle, status, liturgical_text_title, liturgical_text, liturgical_text_reference, image_url, notes, created_by, updated_at)
  values (coalesce(mass_id, gen_random_uuid()), parish_id, mass_date, mass_time_id, title, subtitle, liturgical_cycle, status, liturgical_text_title, liturgical_text, liturgical_text_reference, image_url, notes, auth.uid(), now())
  on conflict (parish_id, mass_date, mass_time_id) do update set title = excluded.title, subtitle = excluded.subtitle, liturgical_cycle = excluded.liturgical_cycle, status = excluded.status, liturgical_text_title = excluded.liturgical_text_title, liturgical_text = excluded.liturgical_text, liturgical_text_reference = excluded.liturgical_text_reference, image_url = excluded.image_url, notes = excluded.notes, updated_at = now()
  returning id into saved_id;
  delete from public.mass_assignments where mass_assignments.mass_id = saved_id;
  insert into public.mass_assignments (mass_id, service_id, person_id, display_order)
  select saved_id, (item->>'service_id')::uuid, (item->>'person_id')::uuid, coalesce((item->>'display_order')::int, 0)
  from jsonb_array_elements(assignments) item;
  return saved_id;
end;
$$;
