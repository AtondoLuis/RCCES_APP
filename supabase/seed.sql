insert into public.parishes (id, name) values ('00000000-0000-0000-0000-000000000001', 'Parroquia Santo Toribio Romo') on conflict (id) do nothing;
insert into public.service_categories (name, display_order) values ('Recepción',1),('Proclamadores',2),('Servicio del Altar',3),('Colecta',4),('Limpieza',5) on conflict (name) do nothing;
insert into public.services (category_id,name,allow_multiple_people,display_order) select c.id, x.name, x.multiple, x.ord from public.service_categories c cross join (values ('Recepción','Bienvenida',false,1),('Recepción','Oración para el servicio',false,2),('Recepción','Campanero',false,3),('Recepción','Ofrenda - Pan y Vino',true,4),('Proclamadores','Monitor',false,1),('Proclamadores','Primera Lectura',false,2),('Proclamadores','Salmo',false,3),('Proclamadores','Segunda Lectura y Aclamación',false,4),('Proclamadores','Apoyo al Sacerdote / Ministros',false,5),('Servicio del Altar','Turiferario',false,1),('Servicio del Altar','Navetero',false,2),('Servicio del Altar','Evangeliario',false,3),('Servicio del Altar','Cruz Alta',false,4),('Servicio del Altar','Cirial 1',false,5),('Servicio del Altar','Cirial 2',false,6),('Colecta','Colecta',true,1),('Limpieza','Limpieza Hombres',true,1),('Limpieza','Limpieza Mujeres',true,2)) x(category,name,multiple,ord) where c.name=x.category on conflict (category_id,name) do nothing;
insert into public.mass_times (parish_id,name,time,display_order) values ('00000000-0000-0000-0000-000000000001','8:00 AM','08:00',1),('00000000-0000-0000-0000-000000000001','10:00 AM','10:00',2),('00000000-0000-0000-0000-000000000001','12:00 PM','12:00',3),('00000000-0000-0000-0000-000000000001','2:00 PM','14:00',4),('00000000-0000-0000-0000-000000000001','5:00 PM','17:00',5),('00000000-0000-0000-0000-000000000001','7:00 PM','19:00',6) on conflict do nothing;
insert into public.parish_settings (parish_id,women_clothing,men_clothing,general_clothing,default_notes) values ('00000000-0000-0000-0000-000000000001','Falda negra y blusa blanca','Pantalón negro y camisa blanca','Zapatos','En caso de faltar algún hermano entrarán a apoyar los servidores que no tienen servicio asignado.') on conflict (parish_id) do nothing;

update public.services set stable_key = lower(regexp_replace(translate(name, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^a-zA-Z0-9]+', '_', 'g')) where stable_key is null;

insert into public.people (id, parish_id, first_name, last_name, display_name, phone, whatsapp, email, gender, active, notes) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','María','García','María García','555-0101','555-0101','maria@example.com','female',true,'Servidora de salmo'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','José','López','José López','555-0102','555-0102','jose@example.com','male',true,'Servidor de altar'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Ana','Martínez','Ana Martínez','555-0103','555-0103','ana@example.com','female',true,'Proclamadora'),
('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Luis','Hernández','Luis Hernández','555-0104','555-0104','luis@example.com','male',true,'Colecta y recepción')
on conflict (id) do update set display_name = excluded.display_name, phone = excluded.phone, whatsapp = excluded.whatsapp, email = excluded.email, gender = excluded.gender, active = excluded.active, notes = excluded.notes;

insert into public.person_services (person_id, service_id)
select p.id, s.id from public.people p join public.services s on s.name in ('Salmo','Primera Lectura','Segunda Lectura y Aclamación') where p.id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003')
on conflict do nothing;
insert into public.person_services (person_id, service_id)
select '10000000-0000-0000-0000-000000000002', s.id from public.services s where s.name in ('Turiferario','Navetero','Evangeliario','Cruz Alta','Cirial 1','Cirial 2')
on conflict do nothing;
insert into public.person_services (person_id, service_id)
select '10000000-0000-0000-0000-000000000004', s.id from public.services s where s.name in ('Bienvenida','Oración para el servicio','Colecta')
on conflict do nothing;


update public.services set slug = v.slug, stable_key = v.slug
from (values
('Bienvenida','bienvenida'),('Oración para el servicio','oracion-servicio'),('Campanero','campanero'),('Ofrenda - Pan y Vino','ofrenda'),('Monitor','monitor'),('Primera Lectura','primera-lectura'),('Salmo','salmo'),('Segunda Lectura y Aclamación','segunda-lectura'),('Apoyo al Sacerdote / Ministros','apoyo-sacerdote'),('Turiferario','turiferario'),('Navetero','navetero'),('Evangeliario','evangeliario'),('Cruz Alta','cruz-alta'),('Cirial 1','cirial-1'),('Cirial 2','cirial-2'),('Colecta','colecta'),('Limpieza Hombres','limpieza-hombres'),('Limpieza Mujeres','limpieza-mujeres')
) as v(name, slug) where public.services.name = v.name;

insert into public.people (id, parish_id, first_name, last_name, display_name, phone, whatsapp, email, gender, active, notes) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Laura','','Laura',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','América','','América',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Janeth','','Janeth',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Cristina','','Cristina',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Jesús Adrián','','Jesús Adrián',null,null,null,'male',true,''),
('20000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Paty','López','Paty López',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','José','Alfredo','José Alfredo',null,null,null,'male',true,''),
('20000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','Flor','','Flor',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','Martha','González','Martha González',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Martha','Espinoza','Martha Espinoza',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Salvador','','Salvador',null,null,null,'male',true,''),
('20000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Gaby','Mateo','Gaby Mateo',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','Melani','','Melani',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001','Diana','','Diana',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000001','Daniel','','Daniel',null,null,null,'male',true,''),
('20000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000001','Antonio','Muro','Antonio Muro',null,null,null,'male',true,''),
('20000000-0000-0000-0000-000000000017','00000000-0000-0000-0000-000000000001','Camila','','Camila',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000018','00000000-0000-0000-0000-000000000001','Lizeth','','Lizeth',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000019','00000000-0000-0000-0000-000000000001','Paty','Preciado','Paty Preciado',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','Ana Lilia','Rangel','Ana Lilia Rangel',null,null,null,'female',true,''),
('20000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','Carlos','Lugo','Carlos Lugo',null,null,null,'male',true,'')
on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name, display_name = excluded.display_name, gender = excluded.gender, active = true;

insert into public.person_services (person_id, service_id)
select p.id, s.id
from public.people p
join public.services s on (
  (p.display_name in ('Laura','América','Janeth','Cristina','Paty López','Flor','Martha González','Martha Espinoza','Gaby Mateo','Melani','Diana','Camila','Lizeth','Paty Preciado','Ana Lilia Rangel') and s.slug in ('bienvenida','oracion-servicio','monitor','primera-lectura','salmo','segunda-lectura','colecta','limpieza-mujeres'))
  or (p.display_name in ('Jesús Adrián','José Alfredo','Salvador','Daniel','Antonio Muro','Carlos Lugo') and s.slug in ('campanero','apoyo-sacerdote','turiferario','navetero','evangeliario','cruz-alta','cirial-1','cirial-2','colecta','limpieza-hombres'))
)
where p.id::text like '20000000-%'
on conflict do nothing;
