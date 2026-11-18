import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { test } from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

test("treasury and attendance RPCs keep payments atomic, auditable, and unique", async () => {
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
    await db.query("insert into profiles(id,role,parish_id) values($1,'ADMIN',$2)", [id(1), id(100)]);
    await db.query("insert into people(id,parish_id,first_name,last_name,display_name) values($1,$2,'Ana','Lopez','Ana Lopez'),($3,$2,'Luis','Perez','Luis Perez')", [id(10), id(100), id(11)]);
    await db.query("insert into profiles(id,role,parish_id,person_id) values($1,'LECTOR',$2,$3)", [id(2), id(100), id(10)]);
    await db.query("select set_config('test.uid',$1,false)", [id(1)]);
    await db.exec("set role authenticated");

    const eventId = (await db.query("select create_fundraising_event($1,$2,$3,$4,$5) as id", ["Colecta", null, null, 100, [id(10), id(11)]])).rows[0].id;
    const requestId = id(500);
    const paymentId = (await db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5) as id", [eventId, id(10), requestId, 40, "2026-11-17"])).rows[0].id;
    assert.equal((await db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5) as id", [eventId, id(10), requestId, 40, "2026-11-17"])).rows[0].id, paymentId);
    assert.equal((await db.query("select count(*)::int as count from treasury_transactions where fundraising_payment_id=$1", [paymentId])).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from fundraising_payments where request_id=$1", [requestId])).rows[0].count, 1);
    await db.query("select update_fundraising_payment($1,$2,$3)", [paymentId, 120, "2026-11-16"]);
    assert.equal((await db.query("select amount from treasury_transactions where fundraising_payment_id=$1", [paymentId])).rows[0].amount, "120.00");
    await db.query("select void_fundraising_payment($1,$2)", [paymentId, "Pago duplicado corregido"]);
    assert.equal((await db.query("select status from treasury_transactions where fundraising_payment_id=$1", [paymentId])).rows[0].status, "voided");
    assert.equal((await db.query("select count(*)::int as count from treasury_audit where payment_id=$1", [paymentId])).rows[0].count, 3);
    const otherPayment = (await db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5) as id", [eventId, id(11), id(501), 50, "2026-11-17"])).rows[0].id;
    const emptyEventId = (await db.query("select create_fundraising_event($1,$2,$3,$4,$5) as id", ["Nuevo", null, null, 100, []])).rows[0].id;
    await db.query("select update_fundraising_event($1,$2,$3,$4,$5)", [emptyEventId, "Nuevo ajustado", null, null, 120]);
    assert.equal((await db.query("select add_fundraising_participants($1,$2) as count", [emptyEventId, [id(10), id(11), id(10)]])).rows[0].count, 2);
    assert.equal((await db.query("select add_fundraising_participants($1,$2) as count", [emptyEventId, [id(10)]])).rows[0].count, 0);
    assert.equal((await db.query("select sum(required_amount) as total from fundraising_participants where event_id=$1", [emptyEventId])).rows[0].total, "240.00");
    const fullId = (await db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5) as id", [emptyEventId, id(10), id(502), null, "2026-11-17"])).rows[0].id;
    assert.equal((await db.query("select amount from fundraising_payments where id=$1", [fullId])).rows[0].amount, "120.00");
    await assert.rejects(db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5)", [emptyEventId, id(10), id(503), null, "2026-11-17"]), /aportación ya completada/);
    assert.equal((await db.query("select remove_fundraising_participant($1,$2) as result", [emptyEventId, id(11)])).rows[0].result, "removed");
    assert.equal((await db.query("select add_fundraising_participants($1,$2) as count", [emptyEventId, [id(11)]])).rows[0].count, 1);
    await db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5)", [emptyEventId, id(11), id(505), 50, "2026-11-17"]);
    const balancePayment = (await db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5) as id", [emptyEventId, id(11), id(506), null, "2026-11-17"])).rows[0].id;
    assert.equal((await db.query("select amount from fundraising_payments where id=$1", [balancePayment])).rows[0].amount, "70.00");
    assert.equal((await db.query("select amount from treasury_transactions where fundraising_payment_id=$1", [balancePayment])).rows[0].amount, "70.00");
    assert.equal((await db.query("select remove_fundraising_participant($1,$2) as result", [emptyEventId, id(10)])).rows[0].result, "cancelled");
    assert.equal((await db.query("select status from fundraising_participants where event_id=$1 and server_id=$2", [emptyEventId, id(10)])).rows[0].status, "cancelled");
    assert.equal((await db.query("select count(*)::int as count from treasury_transactions where fundraising_payment_id=$1", [fullId])).rows[0].count, 1);

    const transactionId = (await db.query("select create_treasury_transaction($1,$2,$3,$4,$5,$6,$7) as id",
      ["2026-11-17", "Compra", "salida", 30, "gasto", null, null])).rows[0].id;
    await db.query("select update_treasury_transaction($1,$2,$3,$4,$5,$6,$7,$8)",
      [transactionId, "2026-11-16", "Compra ajustada", "salida", 25, "gasto", null, "Revisado"]);
    assert.equal((await db.query("select amount from treasury_transactions where id=$1", [transactionId])).rows[0].amount, "25.00");
    await db.query("select void_treasury_transaction($1,$2)", [transactionId, "Cancelado"]);
    assert.equal((await db.query("select count(*)::int as count from treasury_audit where transaction_id=$1", [transactionId])).rows[0].count, 3);

    const activityTypeId = (await db.query("select id from activity_types where parish_id=$1 and name='Asamblea'", [id(100)])).rows[0].id;
    const activityId = (await db.query(
      "insert into community_activities(parish_id,activity_type_id,name,activity_date,start_time) values($1,$2,'Asamblea','2026-11-17','19:00') returning id",
      [id(100), activityTypeId])).rows[0].id;
    await db.query("insert into activity_participants(activity_id,server_id) values($1,$2),($1,$3)", [activityId, id(10), id(11)]);
    await db.query("select toggle_attendance($1,$2,true)", [activityId, id(10)]);
    await db.query("select close_attendance_capture($1)", [activityId]);
    const statuses = await db.query("select status from attendance_records where activity_id=$1 order by server_id", [activityId]);
    assert.deepEqual(statuses.rows.map((row) => row.status), ["present", "absent"]);
    await assert.rejects(db.query("select toggle_attendance($1,$2,false)", [activityId, id(10)]), /captura ya fue cerrada/);

    await db.exec("reset role");
    await db.query("select set_config('test.uid',$1,false)", [id(2)]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select count(*)::int as count from fundraising_participants")).rows[0].count, 2);
    assert.equal((await db.query("select app_private.is_linked_server($1) as linked", [id(10)])).rows[0].linked, true);
    assert.equal((await db.query("select * from treasury_transactions")).rows.length, 0);
    assert.deepEqual((await db.query("select id from fundraising_payments order by id")).rows.map((row) => row.id), [paymentId, fullId].sort());
    assert.equal((await db.query("select * from fundraising_events")).rows.length, 2);
    assert.deepEqual((await db.query("select status from attendance_records")).rows.map((row) => row.status), ["present"]);
    assert.equal((await db.query("select * from activity_participants")).rows.length, 1);
    await assert.rejects(db.query("select register_fundraising_payment_once($1,$2,$3,$4,$5)", [eventId, id(10), id(504), 20, "2026-11-17"]), /No autorizado/);
    await assert.rejects(db.query("select update_fundraising_payment($1,$2,$3)", [otherPayment, 99, "2026-11-17"]), /No autorizado/);
  } finally {
    await db.close();
  }
});
