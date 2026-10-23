import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test } from "node:test";
const migrations = new URL("../supabase/migrations/", import.meta.url);
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12,"0")}`;
test("SQL migrations: configurable slots, liturgy-only writes, confirmed-only lector and tenant isolation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$; create role authenticated; create role anon; create role service_role bypassrls;`);
    let base = readFileSync(new URL("0001_initial_schema.sql", migrations),"utf8").replace(/^\uFEFF/, "").replace('create extension if not exists "pgcrypto";', "");
    base = base.slice(0,base.indexOf("insert into storage.buckets")) + base.slice(base.indexOf("alter table public.services add column if not exists stable_key"));
    await db.exec(base);
    await db.query("insert into parishes(id,name) values($1,'Parish'),($2,'Foreign')",[id(100),id(101)]);
    await db.query("insert into service_categories(id,name) values($1,'Services')",[id(400)]);
    for (const [offset,key,name] of [[0,"colecta","Colecta"],[1,"ofrenda","Ofrenda - Pan y Vino"],[2,"reading","Primera Lectura"],[3,"bienvenida","Bienvenida"],[4,"limpieza-hombres","Limpieza"]]) {
      await db.query("insert into services(id,category_id,name,slug,stable_key) values($1,$2,$3,$4,$4)",[id(500+offset),id(400),name,key]);
    }
    for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name !== "0001_initial_schema.sql").sort()) await db.exec(readFileSync(new URL(name,migrations),"utf8").replace(/^\uFEFF/, ""));
    await db.exec("grant usage on schema public,auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated;");
    assert.equal((await db.query("select required_servers from services where id=$1",[id(500)])).rows[0].required_servers,4);
    assert.equal((await db.query("select required_servers from services where id=$1",[id(501)])).rows[0].required_servers,2);
    assert.equal((await db.query("select required_servers from services where id=$1",[id(502)])).rows[0].required_servers,1);
    for (const value of [0,-1,null,3.5]) await assert.rejects(db.query("update services set required_servers=$1 where id=$2",[value,id(502)]));
    for(let i=1;i<=6;i++) await db.query("insert into auth.users values($1)",[id(i)]);
    for(const [i,role,parish] of [[1,"ADMIN",100],[2,"COORDINADOR",100],[3,"LECTOR",100],[4,"COORDINADOR_LITURGIA",100],[5,"ADMIN",101]]) await db.query("insert into profiles(id,role,parish_id) values($1,$2,$3)",[id(i),role,id(parish)]);
    for(const [person,parish] of [[200,100],[201,100],[202,101]]) await db.query("insert into people(id,parish_id,first_name) values($1,$2,'Server')",[id(person),id(parish)]);
    for(const [time,parish] of [[300,100],[301,101]]) await db.query("insert into mass_times(id,parish_id,name,time) values($1,$2,'Noon','12:00')",[id(time),id(parish)]);
    for(const [offset,status,parish,person,time] of [[0,"draft",100,200,300],[1,"published",100,200,300],[2,"finished",100,200,300],[3,"cancelled",100,200,300],[4,"published",101,202,301]]) {
      const date=`2026-10-${18+offset}`;
      await db.query("insert into masses(id,parish_id,mass_time_id,mass_date,title,status) values($1,$2,$3,$4,'Misa',$5)",[id(600+offset),id(parish),id(time),date,status]);
      await db.query("insert into mass_assignments(mass_id,service_id,person_id) values($1,$2,$3)",[id(600+offset),id(502),id(person)]);
      await db.query("insert into cleaning_assignments(parish_id,cleaning_date,gender_group,person_id,mass_id,service_id) values($1,$2,'men',$3,$4,$5)",[id(parish),date,id(person),id(600+offset),id(504)]);
    }
    const asUser=async(user)=>{await db.exec("reset role");await db.query("select set_config('test.uid',$1,false)",[id(user)]);await db.exec("set role authenticated");};
    await asUser(3);
    assert.equal((await db.query("select * from masses")).rows.length,1);
    assert.equal((await db.query("select * from masses where status in ('draft','published','finished','cancelled')")).rows.length,1);
    for(const mass of [600,602,603,604]) assert.equal((await db.query("select * from masses where id=$1",[id(mass)])).rows.length,0);
    assert.equal((await db.query("select * from mass_assignments")).rows.length,1);
    assert.equal((await db.query("select * from cleaning_assignments")).rows.length,1);
    assert.equal((await db.query("update masses set title='Forbidden' returning id")).rows.length,0);
    await asUser(4);
    assert.equal((await db.query("select * from masses")).rows.length,4);
    assert.equal((await db.query("select * from people")).rows.length,2);
    assert.equal((await db.query("select * from mass_times")).rows.length,1);
    for(const query of ["update profiles set role='ADMIN' returning id", "update people set first_name='Forbidden' returning id", "update services set required_servers=3 returning id", "update mass_times set name='Forbidden' returning id"]) assert.equal((await db.query(query)).rows.length,0);
    await assert.rejects(db.query("insert into services(category_id,name) values($1,'Forbidden')",[id(400)]));
    await assert.rejects(db.query("insert into mass_assignments(mass_id,service_id,person_id) values($1,$2,$3)",[id(600),id(502),id(202)]));
    assert.equal((await db.query("update masses set title='Forbidden' where id=$1 returning id",[id(602)])).rows.length,0);
    const save = (status) => db.query("select save_mass_with_assignments($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) as id",[id(700),id(100),"2026-11-01",id(300),"New Mass",null,null,status,null,null,null,null,null,JSON.stringify([{service_id:id(502),person_id:id(200),display_order:0},{service_id:id(504),person_id:id(200),display_order:0},{service_id:id(503),person_id:id(201),display_order:0}])]);
    assert.equal((await save("draft")).rows[0].id,id(700));
    assert.equal((await save("published")).rows[0].id,id(700));
    assert.equal((await db.query("select * from mass_assignments where mass_id=$1",[id(700)])).rows.length,1);
    assert.equal((await db.query("select * from cleaning_assignments where mass_id=$1",[id(700)])).rows.length,1);
    await assert.rejects(save("finished"));
    await asUser(3);
    assert.equal((await db.query("select * from masses")).rows.length,2);
    await assert.rejects(save("draft"),/No autorizado/);
    await asUser(1);
    await db.query("update services set required_servers=3 where id=$1",[id(502)]);
    assert.equal((await db.query("select required_servers from services where id=$1",[id(502)])).rows[0].required_servers,3);
    await assert.rejects(db.query("update profiles set active=false where id=$1",[id(1)]),/ADMIN activo/);
  } finally { await db.close(); }
});
