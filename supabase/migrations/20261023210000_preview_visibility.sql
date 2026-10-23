alter table public.masses
  add column preview_visibility jsonb not null
  default '{"hidden_categories":[],"hidden_services":[]}'::jsonb;

alter table public.masses
  add constraint masses_preview_visibility_shape check (
    jsonb_typeof(preview_visibility) = 'object'
    and jsonb_typeof(preview_visibility -> 'hidden_categories') = 'array'
    and jsonb_typeof(preview_visibility -> 'hidden_services') = 'array'
  );

create function public.save_mass_with_preview(
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
  p_assignments jsonb,
  p_preview_visibility jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_saved_id uuid;
  v_updated_id uuid;
begin
  if p_preview_visibility is null then
    raise exception 'Visibilidad inválida';
  end if;
  v_saved_id := public.save_mass_with_assignments(
    p_mass_id, p_parish_id, p_mass_date, p_mass_time_id, p_title,
    p_subtitle, p_liturgical_cycle, p_status, p_liturgical_text_title,
    p_liturgical_text, p_liturgical_text_reference, p_image_url, p_notes,
    p_assignments
  );
  update public.masses
  set preview_visibility = p_preview_visibility
  where id = v_saved_id and parish_id = p_parish_id
  returning id into v_updated_id;
  if v_updated_id is null then
    raise exception 'No se pudo guardar la visibilidad';
  end if;
  return v_saved_id;
end;
$$;

revoke all on function public.save_mass_with_preview(uuid, uuid, date, uuid, text, text, text, public.mass_status, text, text, text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.save_mass_with_preview(uuid, uuid, date, uuid, text, text, text, public.mass_status, text, text, text, text, text, jsonb, jsonb)
  to authenticated, service_role;
