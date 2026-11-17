import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("treasury and attendance migration contains atomic and auditable safeguards", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261117000100_treasury_attendance_modules.sql", import.meta.url), "utf8");
  assert.match(sql, /numeric\(12,2\)/);
  assert.match(sql, /register_fundraising_payment/);
  assert.match(sql, /fundraising_payment_id[\s\S]*unique/);
  assert.match(sql, /void_fundraising_payment/);
  assert.match(sql, /close_attendance_capture/);
  assert.match(sql, /unique\(activity_id, server_id\)/);
  assert.match(sql, /status text not null default 'pending' check \(status in \('pending','present','absent'\)\)/);
});

test("permissions expose treasury and attendance to compatible roles", async () => {
  const source = readFileSync(new URL("../src/lib/permissions.ts", import.meta.url), "utf8");
  assert.match(source, /TESORERO/);
  assert.match(source, /manageTreasury/);
  assert.match(source, /manageAttendance/);
  assert.match(source, /path\.startsWith\("\/tesoreria"\)/);
  assert.match(source, /path\.startsWith\("\/asistencias"\)/);
});

test("attendance profile lookups are limited to the authenticated user", () => {
  const source = readFileSync(new URL("../src/app/asistencias/page.tsx", import.meta.url), "utf8");
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /\.from\("profiles"\)\.select\("role,parish_id"\)\.eq\("id",userData\.user\.id\)\.maybeSingle\(\)/);
  assert.doesNotMatch(source, /\.from\("profiles"\)\.select\("role"\)\.maybeSingle\(\)/);
});
