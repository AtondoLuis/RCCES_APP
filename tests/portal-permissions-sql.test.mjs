import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test } from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

test("server portal permissions isolate personal records, honor overrides, and scope notices", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create role authenticated; create role anon; create role service_role bypassrls;`);
    let base = readFileSync(new URL("0001_initial_schema.sql", migrations), "utf8").replace(/^\uFEFF/, "").replace('create extension if not exists "pgcrypto";', "");
    base = base.slice(0, base.indexOf("insert into storage.buckets")) + base.slice(base.indexOf("alter table public.services add column if not exists stable_key"));
    await db.exec(base);
    for (const filename of readdirSync(migrations).filter((filename) => filename.endsWith(".sql") && filename !== "0001_initial_schema.sql").sort()) {
      await db.exec(readFileSync(new URL(filename, migrations), "utf8").replace(/^\uFEFF/, ""));
    }
    await db.exec("grant usage on schema public,auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated;");
    await db.query("insert into parishes(id,name) values($1,'RCCES')", [id(100)]);
    await db.query("insert into auth.users(id) values($1),($2)", [id(1), id(2)]);
    await db.query("insert into people(id,parish_id,first_name,last_name,class_id) values($1,$2,'Ana','Lopez','crecimiento-5'),($3,$2,'Luis','Perez','crecimiento-4')", [id(10), id(100), id(11)]);
    await db.query("insert into profiles(id,role,parish_id,person_id,phone_contact) values($1,'ADMIN',$2,null,null),($3,'SERVIDOR',$2,$4,'+526641234567')", [id(1), id(100), id(2), id(10)]);
    await db.query("insert into service_categories(id,name) values($1,'Liturgia')", [id(20)]);
    await db.query("insert into services(id,category_id,name) values($1,$2,'Lectura')", [id(21), id(20)]);
    await db.query("insert into masses(id,parish_id,mass_date,title,status) values($1,$2,'2030-01-01','Comisión propia','published'),($3,$2,'2030-01-02','Comisión ajena','published'),($4,$2,'2030-01-03','Borrador','draft')", [id(30), id(100), id(31), id(32)]);
    await db.query("insert into mass_assignments(mass_id,service_id,person_id) values($1,$2,$3),($4,$2,$5),($6,$2,$3)", [id(30), id(21), id(10), id(31), id(11), id(32)]);

    await db.query("select set_config('test.uid',$1,false)", [id(1)]);
    await db.exec("set role authenticated");
    const noticeId = (await db.query("select create_announcement($1,$2,null,null,$3,$4,null,$5,$6) as id",
      ["Aviso general", "Información para todos", "normal", "all", [], "published"])).rows[0].id;
    await db.query("select create_announcement($1,$2,null,null,$3,$4,null,$5,$6)",
      ["Aviso privado", "Solo otro servidor", "normal", "selected", [id(11)], "published"]);
    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(2)]);
    await db.exec("set role authenticated");

    assert.equal((await db.query("select has_app_permission('portal.view') as allowed")).rows[0].allowed, true);
    assert.equal((await db.query("select phone_contact from profiles")).rows[0].phone_contact, "+526641234567");
    assert.deepEqual((await db.query("select id from people order by id")).rows.map((row) => row.id), [id(10)]);
    assert.deepEqual((await db.query("select title from masses order by title")).rows.map((row) => row.title), ["Comisión propia"]);
    assert.deepEqual((await db.query("select person_id from mass_assignments")).rows.map((row) => row.person_id), [id(10)]);
    assert.deepEqual((await db.query("select title from announcements")).rows.map((row) => row.title), ["Aviso general"]);
    await db.query("insert into announcement_reads(announcement_id,profile_id) values($1,$2)", [noticeId, id(2)]);
    assert.equal((await db.query("select count(*)::int as count from announcement_reads where profile_id=$1", [id(2)])).rows[0].count, 1);
    assert.equal((await db.query("select has_app_permission('treasury.view') as allowed")).rows[0].allowed, false);
    await assert.rejects(db.query("select create_announcement($1,$2,null,null,$3,$4,null,$5,$6)",
      ["No autorizado", "Sin permiso", "normal", "all", [], "published"]), /No autorizado/);
    await assert.rejects(db.query("select set_profile_permission_overrides($1,$2)", [id(2), JSON.stringify([{ permission_key: "treasury.view", allowed: true }])]), /No autorizado/);

    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(1)]);
    await db.exec("set role authenticated");
    await db.query("select set_profile_permission_overrides($1,$2)", [id(2), JSON.stringify([{ permission_key: "treasury.view", allowed: true }])]);
    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(2)]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select has_app_permission('treasury.view') as allowed")).rows[0].allowed, true);

    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(1)]);
    await db.exec("set role authenticated");
    await db.query("select set_profile_permission_overrides($1,$2)", [id(2), JSON.stringify([{ permission_key: "treasury.view", allowed: true }, { permission_key: "users.manage_permissions", allowed: true }])]);
    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(2)]);
    await db.exec("set role authenticated");
    const managedProfiles = (await db.query("select * from list_permission_profiles()")).rows;
    assert.deepEqual(managedProfiles.map((row) => row.profile_id), [id(1)]);
    assert.equal("phone_contact" in managedProfiles[0], false);
    await db.query("select set_profile_permission_overrides($1,$2)", [id(1), JSON.stringify([{ permission_key: "notices.manage", allowed: true }])]);
    assert.equal((await db.query("select count(*)::int as count from permission_audit where target_profile_id=$1", [id(1)])).rows[0].count, 1);

    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(1)]);
    await db.exec("set role authenticated");
    await db.query("select set_profile_permission_overrides($1,'[]'::jsonb)", [id(2)]);
    assert.equal((await db.query("select count(*)::int as count from permission_audit where target_profile_id=$1", [id(2)])).rows[0].count, 4);
    await assert.rejects(db.query("select set_profile_permission_overrides($1,'[]'::jsonb)", [id(1)]), /No puedes modificar tus propios permisos/);
  } finally {
    await db.close();
  }
});
