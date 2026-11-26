alter table public.people
  add column if not exists birth_day smallint,
  add column if not exists birth_month smallint;

alter table public.people
  drop constraint if exists people_birth_day_month_check;

alter table public.people
  add constraint people_birth_day_month_check
  check (
    (birth_day is null and birth_month is null)
    or (
      birth_day is not null
      and birth_month is not null
      and birth_month between 1 and 12
      and birth_day between 1 and case birth_month
        when 2 then 29
        when 4 then 30
        when 6 then 30
        when 9 then 30
        when 11 then 30
        else 31
      end
    )
  );
