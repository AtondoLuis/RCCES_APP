create extension if not exists "pgcrypto";

do $$ begin create type public.user_role as enum ('ADMIN','COORDINADOR','LECTOR'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mass_status as enum ('draft','published','finished','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.availability_status as enum ('available','unavailable','pending'); exception when duplicate_object then null; end $$;

create table if not exists public.parishes (id uuid primary key default gen_random_uuid(), name text not null, logo_url text, patron_image_url text, address text, phone text, created_at timestamptz not null default now());
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text, full_name text, role public.user_role not null default 'LECTOR', parish_id uuid references public.parishes(id) on delete set null, created_at timestamptz not null default now());
create table if not exists public.service_categories (id uuid primary key default gen_random_uuid(), name text not null unique, display_order int not null default 0);
create table if not exists public.services (id uuid primary key default gen_random_uuid(), category_id uuid not null references public.service_categories(id) on delete cascade, name text not null, description text, allow_multiple_people boolean not null default false, active boolean not null default true, display_order int not null default 0, unique(category_id, name));
create table if not exists public.people (id uuid primary key default gen_random_uuid(), parish_id uuid not null references public.parishes(id) on delete cascade, first_name text not null, last_name text not null default '', display_name text, phone text, whatsapp text, email text, gender text check (gender in ('female','male','other')), active boolean not null default true, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.person_services (person_id uuid not null references public.people(id) on delete cascade, service_id uuid not null references public.services(id) on delete cascade, primary key(person_id, service_id));
create table if not exists public.mass_times (id uuid primary key default gen_random_uuid(), parish_id uuid not null references public.parishes(id) on delete cascade, name text not null, time time not null, active boolean not null default true, display_order int not null default 0, unique(parish_id, time));
create table if not exists public.masses (id uuid primary key default gen_random_uuid(), parish_id uuid not null references public.parishes(id) on delete cascade, mass_date date not null, mass_time_id uuid references public.mass_times(id) on delete restrict, title text not null, subtitle text, liturgical_cycle text, status public.mass_status not null default 'draft', liturgical_text_title text, liturgical_text text, liturgical_text_reference text, image_url text, notes text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(parish_id, mass_date, mass_time_id));
create table if not exists public.mass_assignments (id uuid primary key default gen_random_uuid(), mass_id uuid not null references public.masses(id) on delete cascade, service_id uuid not null references public.services(id) on delete restrict, person_id uuid not null references public.people(id) on delete restrict, display_order int not null default 0, notes text);
create table if not exists public.person_availability (id uuid primary key default gen_random_uuid(), person_id uuid not null references public.people(id) on delete cascade, mass_date date not null, mass_time_id uuid references public.mass_times(id) on delete cascade, status public.availability_status not null default 'pending', notes text, unique(person_id, mass_date, mass_time_id));
create table if not exists public.parish_settings (id uuid primary key default gen_random_uuid(), parish_id uuid not null unique references public.parishes(id) on delete cascade, women_clothing text, men_clothing text, general_clothing text, default_notes text, allow_multiple_services boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.cleaning_assignments (id uuid primary key default gen_random_uuid(), parish_id uuid not null references public.parishes(id) on delete cascade, cleaning_date date not null, gender_group text not null, person_id uuid not null references public.people(id) on delete restrict);

create index if not exists people_parish_active_idx on public.people(parish_id, active);
create index if not exists masses_parish_date_idx on public.masses(parish_id, mass_date desc);
create index if not exists assignments_mass_idx on public.mass_assignments(mass_id);
create index if not exists assignments_person_idx on public.mass_assignments(person_id);

alter table public.parishes enable row level security; alter table public.profiles enable row level security; alter table public.service_categories enable row level security; alter table public.services enable row level security; alter table public.people enable row level security; alter table public.person_services enable row level security; alter table public.mass_times enable row level security; alter table public.masses enable row level security; alter table public.mass_assignments enable row level security; alter table public.person_availability enable row level security; alter table public.parish_settings enable row level security; alter table public.cleaning_assignments enable row level security;

create or replace function public.is_staff() returns boolean language sql stable security invoker as $$ select exists(select 1 from public.profiles where id = (select auth.uid()) and role in ('ADMIN','COORDINADOR')); $$;
create or replace function public.current_parish() returns uuid language sql stable security invoker as $$ select parish_id from public.profiles where id = (select auth.uid()); $$;

create policy "authenticated can read parish" on public.parishes for select to authenticated using (true);
create policy "staff manage parish" on public.parishes for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "users read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_staff());
create policy "staff read catalogs" on public.service_categories for select to authenticated using (true);
create policy "staff manage categories" on public.service_categories for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff read services" on public.services for select to authenticated using (true);
create policy "staff manage services" on public.services for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff manage people" on public.people for all to authenticated using (parish_id = public.current_parish() and public.is_staff()) with check (parish_id = public.current_parish() and public.is_staff());
create policy "staff manage person services" on public.person_services for all to authenticated using (exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()) and public.is_staff()) with check (public.is_staff());
create policy "staff manage mass times" on public.mass_times for all to authenticated using (parish_id = public.current_parish() and public.is_staff()) with check (parish_id = public.current_parish() and public.is_staff());
create policy "authenticated read masses" on public.masses for select to authenticated using (parish_id = public.current_parish());
create policy "staff manage masses" on public.masses for all to authenticated using (parish_id = public.current_parish() and public.is_staff()) with check (parish_id = public.current_parish() and public.is_staff());
create policy "authenticated read assignments" on public.mass_assignments for select to authenticated using (exists(select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish()));
create policy "staff manage assignments" on public.mass_assignments for all to authenticated using (exists(select 1 from public.masses m where m.id = mass_id and m.parish_id = public.current_parish()) and public.is_staff()) with check (public.is_staff());
create policy "staff manage availability" on public.person_availability for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "authenticated read settings" on public.parish_settings for select to authenticated using (parish_id = public.current_parish());
create policy "staff manage settings" on public.parish_settings for all to authenticated using (parish_id = public.current_parish() and public.is_staff()) with check (parish_id = public.current_parish() and public.is_staff());
create policy "staff manage cleaning" on public.cleaning_assignments for all to authenticated using (parish_id = public.current_parish() and public.is_staff()) with check (parish_id = public.current_parish() and public.is_staff());

insert into storage.buckets (id, name, public) values ('parish-assets','parish-assets',true), ('mass-images','mass-images',true), ('generated-schedules','generated-schedules',true) on conflict (id) do nothing;
create policy "authenticated upload parish assets" on storage.objects for insert to authenticated with check (bucket_id in ('parish-assets','mass-images','generated-schedules'));
create policy "public read parish assets" on storage.objects for select to public using (bucket_id in ('parish-assets','mass-images','generated-schedules'));

alter table public.services add column if not exists stable_key text;
create unique index if not exists services_stable_key_idx on public.services(stable_key) where stable_key is not null;

create or replace function public.current_user_role() returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = (select auth.uid()) limit 1;
$$;
create or replace function public.current_parish() returns uuid language sql stable security definer set search_path = public as $$
  select parish_id from public.profiles where id = (select auth.uid()) limit 1;
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('ADMIN','COORDINADOR'), false);
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'ADMIN', false);
$$;

create or replace function public.save_mass_with_assignments(
  mass_id uuid,
  parish_id uuid,
  mass_date date,
  mass_time_id uuid,
  title text,
  subtitle text,
  status public.mass_status,
  notes text,
  assignments jsonb
) returns uuid language plpgsql security invoker as $$
declare saved_id uuid;
begin
  if not public.is_staff() then raise exception 'No autorizado'; end if;
  insert into public.masses (id, parish_id, mass_date, mass_time_id, title, subtitle, status, notes, created_by, updated_at)
  values (coalesce(mass_id, gen_random_uuid()), parish_id, mass_date, mass_time_id, title, subtitle, status, notes, auth.uid(), now())
  on conflict (parish_id, mass_date, mass_time_id) do update set title = excluded.title, subtitle = excluded.subtitle, status = excluded.status, notes = excluded.notes, updated_at = now()
  returning id into saved_id;
  delete from public.mass_assignments where mass_assignments.mass_id = saved_id;
  insert into public.mass_assignments (mass_id, service_id, person_id, display_order)
  select saved_id, (item->>'service_id')::uuid, (item->>'person_id')::uuid, coalesce((item->>'display_order')::int, 0)
  from jsonb_array_elements(assignments) item;
  return saved_id;
end;
$$;

drop policy if exists "authenticated read people" on public.people;
create policy "authenticated read people" on public.people for select to authenticated using (parish_id = public.current_parish());
drop policy if exists "authenticated read person services" on public.person_services;
create policy "authenticated read person services" on public.person_services for select to authenticated using (exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()));
drop policy if exists "authenticated read mass times" on public.mass_times;
create policy "authenticated read mass times" on public.mass_times for select to authenticated using (parish_id = public.current_parish());



alter table public.services add column if not exists slug text;
create unique index if not exists services_slug_idx on public.services(slug) where slug is not null;
update public.services set slug = coalesce(slug, stable_key, lower(regexp_replace(translate(name, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^a-zA-Z0-9]+', '-', 'g')));

drop policy if exists "authenticated read availability" on public.person_availability;
create policy "authenticated read availability" on public.person_availability for select to authenticated using (exists(select 1 from public.people p where p.id = person_id and p.parish_id = public.current_parish()));

drop function if exists public.save_mass_with_assignments(uuid, uuid, date, uuid, text, text, public.mass_status, text, jsonb);
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
) returns uuid language plpgsql security invoker as $$
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


