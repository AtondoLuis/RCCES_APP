-- Commit the enum addition before policies and application use it.
alter type public.user_role add value if not exists 'COORDINADOR_LITURGIA';
