create table public.phone_invitations (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 150),
  email text,
  role public.user_role not null,
  active boolean not null default true,
  person_id uuid references public.people(id) on delete restrict,
  phone text not null check (phone ~ '^\+52[0-9]{10}$'),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  claimed_at timestamptz,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint phone_invitations_status_check check (
    not (redeemed_at is not null and revoked_at is not null)
  )
);

create unique index phone_invitations_open_phone_idx
  on public.phone_invitations(parish_id, phone)
  where redeemed_at is null and revoked_at is null;
create index phone_invitations_profile_idx on public.phone_invitations(profile_id);
create index phone_invitations_expiry_idx on public.phone_invitations(expires_at)
  where redeemed_at is null and revoked_at is null;

alter table public.phone_invitations enable row level security;
revoke all on public.phone_invitations from public, anon, authenticated;
grant all on public.phone_invitations to service_role;
