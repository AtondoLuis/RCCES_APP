alter table public.profiles add column active boolean not null default true;
alter table public.profiles add column person_id uuid references public.people(id) on delete restrict;
create unique index profiles_person_unique on public.profiles(person_id) where person_id is not null;
create index profiles_parish_active_role on public.profiles(parish_id, active, role);
alter table public.profiles add constraint profiles_require_parish check (parish_id is not null) not valid;

-- Retain the existing nonrecursive, caller-specific lookup functions. An inactive
-- profile has no effective role or parish, even with an unexpired Auth token.
create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and active limit 1;
$$;
create or replace function public.current_parish() returns uuid
language sql stable security definer set search_path = '' as $$
  select parish_id from public.profiles where id = auth.uid() and active limit 1;
$$;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_parish() from public, anon;
grant execute on function public.current_user_role(), public.current_parish() to authenticated, service_role;

-- Inactive users can still read their own profile to display the access message.
drop policy if exists "users read own profile" on public.profiles;
create policy "own profile or parish admin reads profiles" on public.profiles
for select to authenticated using (id = auth.uid() or (public.is_admin() and parish_id = public.current_parish()));
create policy "parish admin inserts profiles" on public.profiles
for insert to authenticated with check (public.is_admin() and parish_id = public.current_parish());
create policy "parish admin updates profiles" on public.profiles
for update to authenticated using (public.is_admin() and parish_id = public.current_parish())
with check (public.is_admin() and parish_id = public.current_parish());
-- No authenticated DELETE policy: deactivation preserves account history.

-- Restrictive policies combine with existing policies rather than replacing them.
-- This also blocks inactive users from calling the Data API directly.
do $$ declare t text; begin
  foreach t in array array['parishes','service_categories','services','people','person_services','mass_times','masses','mass_assignments','person_availability','parish_settings','cleaning_assignments'] loop
    execute format('create policy "active app account required" on public.%I as restrictive for all to authenticated using (public.current_user_role() is not null and public.current_parish() is not null) with check (public.current_user_role() is not null and public.current_parish() is not null)', t);
  end loop;
end $$;
create policy "own parish only" on public.parishes as restrictive for all to authenticated
using (id = public.current_parish()) with check (id = public.current_parish());
-- Sensitive configuration belongs to ADMIN, not COORDINADOR. Catalog reads remain available.
do $$ declare t text; op text; begin
  foreach t in array array['parishes','service_categories','services','mass_times','parish_settings'] loop
    foreach op in array array['insert','update','delete'] loop
      execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
        'admin configuration ' || op, t, op,
        case when op = 'insert' then 'with check (public.is_admin())'
             when op = 'update' then 'using (public.is_admin()) with check (public.is_admin())'
             else 'using (public.is_admin())' end);
    end loop;
  end loop;
end $$;

-- These trigger functions are internal; never expose a privileged mutation RPC.
create schema if not exists app_private;
revoke all on schema app_private from public;
create function app_private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and (new.id <> old.id or new.parish_id is distinct from old.parish_id) then
    raise exception 'No se puede cambiar la identidad o parroquia de un usuario.' using errcode = '23514';
  end if;
  if TG_OP <> 'DELETE' then
    if new.parish_id is null then raise exception 'El usuario debe pertenecer a una parroquia.' using errcode = '23514'; end if;
    if new.person_id is not null then
      perform id from public.people where id = new.person_id and parish_id = new.parish_id for share;
      if not found then raise exception 'El servidor debe pertenecer a la misma parroquia.' using errcode = '23514'; end if;
    end if;
  end if;
  if TG_OP in ('UPDATE', 'DELETE') and old.active and old.role = 'ADMIN' then
    if TG_OP = 'DELETE' or not new.active or new.role <> 'ADMIN' then
      -- Serialize all demotions/deactivations in this parish, including direct SQL/API updates.
      perform id from public.parishes where id = old.parish_id for update;
      if not exists (select 1 from public.profiles where parish_id = old.parish_id and id <> old.id and active and role = 'ADMIN') then
        raise exception 'Debe existir al menos un ADMIN activo en la parroquia.' using errcode = '23514';
      end if;
    end if;
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app_private.guard_profile() from public, anon, authenticated;
create trigger guard_app_profile before insert or update or delete on public.profiles
for each row execute function app_private.guard_profile();

-- A linked person must not be moved to another parish behind the profile FK.
create function app_private.guard_linked_person_parish() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parish_id is distinct from old.parish_id and exists(select 1 from public.profiles where person_id = old.id) then
    raise exception 'El servidor esta vinculado a un usuario de su parroquia.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_linked_person_parish() from public, anon, authenticated;
create trigger guard_linked_person_parish before update of parish_id on public.people
for each row execute function app_private.guard_linked_person_parish();
