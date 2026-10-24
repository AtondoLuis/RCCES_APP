alter table public.people
  add column class_id text
  constraint people_class_id_valid check (
    class_id in (
      'crecimiento-jovenes-1',
      'crecimiento-jovenes-2',
      'crecimiento-5',
      'crecimiento-4'
    )
  );

comment on column public.people.class_id is
  'Identificador estable de la clase de crecimiento; NULL significa Sin asignar.';
