import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, overrides = {}, globals = {}, suffix = "") {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8") + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: testModule.exports, module: testModule,
    require: (name) => name in overrides ? overrides[name]
      : name.startsWith("@/lib/") ? loadTs(`../src/lib/${name.slice(6)}.ts`)
      : name.startsWith("./") ? loadTs(`../src/lib/${name.slice(2)}.ts`)
      : require(name),
    AbortController, console, ...globals,
  });
  return testModule.exports;
}
const { generateAssignments, getEligiblePeople, scoreCandidate } = loadTs("../src/lib/auto-assign.ts");
const { loadAutoAssignData } = loadTs("../src/lib/auto-assign-data.ts");
const { canAssignToService, isAssignedToAnotherService } = loadTs("../src/lib/commission-assignments.ts", { "@/lib/auto-assign": { } });
const { previewAssignmentNames, repeatedPersonIds } = loadTs("../src/lib/commission-preview.ts", { "@/lib/auto-assign": { } });
const plain = (value) => JSON.parse(JSON.stringify(value));
const person = (id, services = ["reading"], patch = {}) => ({ id, parish_id: "p1", active: true, services, ...patch });
const service = (id = "reading", patch = {}) => ({ id, name: id, active: true, display_order: 1, allow_multiple_people: false, ...patch });
const mass = (id, date, patch = {}) => ({ id, mass_date: date, parish_id: "p1", mass_time_id: "time1", time: "12:00:00", status: "published", ...patch });
const input = (patch = {}) => ({ parishId: "p1", date: "2026-10-18", time: "12:00:00", massTimeId: "time1", people: [], services: [service()], masses: [], history: [], availability: [], existingAssignments: {}, ...patch });

test("only active, authorized people in the current parish are eligible", () => {
  const data = input({ people: [person("allowed"), person("inactive", ["reading"], { active: false }), person("foreign", ["reading"], { parish_id: "p2" }), person("unauthorized", ["salmo"])] });
  assert.deepEqual(plain(getEligiblePeople(data, service()).map((p) => p.id)), ["allowed"]);
  assert.equal(generateAssignments(data).assignments.reading[0], "allowed");
  assert.deepEqual(plain(generateAssignments(input({ services: [service("foreign", { parish_id: "p2" }), service("inactive", { active: false })] })).assignments), {});
});
test("respects whole-day, matching-time and matching-mass unavailability; pending and no record remain eligible", () => {
  const availability = (id, time, patch = {}) => ({ person_id: id, mass_date: "2026-10-18", mass_time_id: time, status: "unavailable", ...patch });
  const data = input({ massId: "current", people: ["day", "slot", "mass", "other-time", "other-mass", "pending", "none"].map((id) => person(id)), availability: [availability("day", null), availability("day", "time1", { status: "available" }), availability("slot", "time1"), availability("mass", null, { mass_id: "current" }), availability("other-time", "time2"), availability("other-mass", null, { mass_id: "other" }), availability("pending", "time1", { status: "pending" })] });
  assert.deepEqual(plain(getEligiblePeople(data, service()).map((p) => p.id)), ["other-time", "other-mass", "pending", "none"]);
});
test("rotates away from the previous week and prioritizes the longer wait", () => {
  const data = input({ people: [person("recent"), person("rested")], masses: [mass("previous", "2026-10-11"), mass("old", "2026-08-01")], history: [{ mass_id: "previous", person_id: "recent", service_id: "reading" }, { mass_id: "old", person_id: "rested", service_id: "reading" }] });
  assert.equal(generateAssignments(data).assignments.reading[0], "rested");
});
test("new volunteers receive high priority rather than being disadvantaged by lifetime totals", () => {
  const data = input({ people: [person("experienced"), person("new")], masses: [mass("previous", "2026-10-11")], history: [{ mass_id: "previous", person_id: "experienced", service_id: "reading" }] });
  assert.equal(generateAssignments(data).assignments.reading[0], "new");
});
test("service-specific history dominates otherwise equal general histories", () => {
  const data = input({ people: [person("last-reader"), person("other-role")], masses: [mass("previous", "2026-10-11")], history: [{ mass_id: "previous", person_id: "last-reader", service_id: "reading" }, { mass_id: "previous", person_id: "other-role", service_id: "salmo" }] });
  assert.equal(generateAssignments(data).assignments.reading[0], "other-role");
});
test("uses maximum distinct matching before allowing any repeated person", () => {
  const data = input({ services: [service("one"), service("two"), service("three")], people: [person("a", ["one", "two", "three"]), person("b", ["one", "two"]), person("c", ["three"])] });
  const result = generateAssignments(data);
  assert.equal(new Set(Object.values(result.assignments).flat()).size, 3);
  assert.equal(result.reusedPersonIds.length, 0);
  for (const [id, ids] of Object.entries(result.assignments)) assert(data.people.find((p) => p.id === ids[0]).services.includes(id));
});
test("does not reuse a volunteer across services when multiple services are disabled", () => {
  const result = generateAssignments(input({ services: [service("one", { allow_multiple_people: true }), service("two")], people: [person("a", ["one", "two"])], existingAssignments: { one: ["", ""] } }));
  assert.equal(result.assignments.one.filter(Boolean).length + result.assignments.two.filter(Boolean).length, 1);
  assert.deepEqual(plain(result.reusedPersonIds), []);
});
test("reuses a volunteer only when multiple services are enabled, never twice in the same service", () => {
  const result = generateAssignments(input({ allowMultipleServices: true, services: [service("one", { allow_multiple_people: true }), service("two")], people: [person("a", ["one", "two"])], existingAssignments: { one: ["", ""] } }));
  assert.equal(result.assignments.one.filter(Boolean).length, 1);
  assert.equal(result.assignments.two[0], "a");
  assert.deepEqual(plain(result.unfilledServices), ["one"]);
  assert.deepEqual(plain(result.reusedPersonIds), ["a"]);
});
test("leaves an unfillable service empty while assigning the others", () => {
  const result = generateAssignments(input({ services: [service(), service("salmo")], people: [person("a")] }));
  assert.equal(result.assignments.reading[0], "a");
  assert.deepEqual(plain(result.assignments.salmo), [""]);
  assert.deepEqual(plain(result.unfilledServices), ["salmo"]);
});
test("multiple services preserve only the existing UI slot count, defaulting to one", () => {
  const data = input({ services: [service("reading", { allow_multiple_people: true })], people: [person("a"), person("b"), person("c")] });
  assert.equal(generateAssignments(data).assignments.reading.length, 1);
  assert.equal(generateAssignments({ ...data, existingAssignments: { reading: ["", ""] } }).assignments.reading.length, 2);
  assert.equal(generateAssignments({ ...data, services: [service()], existingAssignments: { reading: ["", ""] } }).assignments.reading.length, 1);
  assert.equal(generateAssignments({ ...data, services: [service()], allowMultipleServices: true, existingAssignments: { reading: ["", ""] } }).assignments.reading.length, 1);
});
test("ignores current, future, cancelled and foreign-parish masses in rotation", () => {
  const data = input({ massId: "current", people: [person("a"), person("b")], masses: [mass("current", "2026-10-18"), mass("future", "2026-10-25"), mass("cancelled", "2026-10-11", { status: "cancelled" }), mass("foreign", "2026-10-11", { parish_id: "p2" })] });
  const baseline = generateAssignments(data);
  data.history = data.masses.map((m) => ({ mass_id: m.id, person_id: baseline.assignments.reading[0], service_id: "reading" }));
  assert.deepEqual(plain(generateAssignments(data)), plain(baseline));
});
test("includes an earlier Mass the same day, but not a later one", () => {
  const data = input({ people: [person("a"), person("b")], masses: [mass("early", "2026-10-18", { time: "08:00:00" }), mass("late", "2026-10-18", { time: "18:00:00" })], history: [{ mass_id: "early", person_id: "a", service_id: "reading" }, { mass_id: "late", person_id: "b", service_id: "reading" }] });
  assert.equal(generateAssignments(data).assignments.reading[0], "b");
});
test("ties are deterministic and outputs stay editable without mutating inputs", () => {
  const data = input({ people: [person("a"), person("b")] });
  const before = JSON.stringify(data);
  const result = generateAssignments(data);
  assert.deepEqual(plain(generateAssignments({ ...data, people: [...data.people].reverse() })), plain(result));
  result.assignments.reading[0] = "manual-change";
  assert.equal(JSON.stringify(data), before);
  assert.notEqual(generateAssignments(data).assignments.reading[0], "manual-change");
});
test("recent 30/60-day activity and previous-Mass participation lower the score", () => {
  const stats = { daysSinceLast: 60, daysSinceService: 60, recent30: 0, recent60: 0, sameService30: 0, lastWeek: 0, servedPreviousMass: false };
  for (const patch of [{ recent30: 1 }, { recent60: 1 }, { sameService30: 1 }, { lastWeek: 1 }, { servedPreviousMass: true }]) assert(scoreCandidate({ ...stats, ...patch }) < scoreCandidate(stats));
});

function queryClient(rows, failureTable) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [], from: 0, to: 499 }; calls.push(call);
    return {
      select(columns) { call.columns = columns; return this; },
      eq(key, value) { call.filters.push(["eq", key, value]); return this; },
      lte(key, value) { call.filters.push(["lte", key, value]); return this; },
      neq(key, value) { call.filters.push(["neq", key, value]); return this; },
      order(key) { call.order = key; return this; },
      range(from, to) { call.from = from; call.to = to; return this; },
      abortSignal(signal) { call.signal = signal; return this; },
      returns() { return Promise.resolve({ data: (rows[table] ?? []).slice(call.from, call.to + 1), error: failureTable === table ? { message: "Read failed" } : null }); },
    };
  } };
}
test("loader scopes parish-owned reads and paginates history beyond one API page", async () => {
  const history = Array.from({ length: 501 }, (_, i) => ({ mass_id: `m${i}`, person_id: "a", service_id: "reading" }));
  const client = queryClient({ mass_assignments: history, people: [{ ...person("a"), person_services: [{ service_id: "reading" }] }], masses: [{ ...mass("m", "2026-10-11"), mass_times: { time: "12:00:00" } }] });
  const signal = new AbortController().signal;
  const result = await loadAutoAssignData(client, "p1", "2026-10-18", signal);
  assert.equal(result.history.length, 501);
  assert.deepEqual(plain(result.people[0].services), ["reading"]);
  for (const table of ["people", "masses", "mass_assignments", "person_availability"]) {
    const call = client.calls.find((c) => c.table === table);
    assert(call.filters.some(([, key, value]) => key.endsWith("parish_id") && value === "p1"));
    assert.equal(call.signal, signal);
    assert.equal(call.order, "id");
  }
  assert.equal(client.calls.filter((c) => c.table === "mass_assignments").length, 2);
});
test("loader rejects incomplete history rather than generating from failed reads", async () => {
  await assert.rejects(loadAutoAssignData(queryClient({}, "mass_assignments"), "p1", "2026-10-18", new AbortController().signal), /Read failed/);
});

function controlsHarness(confirm = true, existing = {}) {
  let hookIndex = 0;
  let cleanup;
  const hooks = [], generated = [], requests = [];
  const React = require("react");
  const data = input({ people: [person("a")], services: [service()] });
  const Controls = loadTs("../src/components/auto-assignment-controls.tsx", {
    react: { ...React,
      useMemo: (fn) => fn(),
      useEffect: (effect) => { cleanup ??= effect(); },
      useState: (initial) => { const i = hookIndex++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], (value) => { hooks[i] = value; }]; },
      useRef: (initial) => { const i = hookIndex++; return hooks[i] ??= { current: initial }; },
    },
    "@/lib/supabase/client": { createClient: () => ({}) },
    "@/lib/auto-assign": { generateAssignments },
    "@/lib/auto-assign-data": { loadAutoAssignData: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) },
  }, { window: { confirm: () => confirm, setTimeout, clearTimeout } }).AutoAssignmentControls;
  return { requests, generated, data,
    cancel() { cleanup?.(); },
    click() { hookIndex = 0; const tree = Controls({ parishId: "p1", date: "2026-10-18", time: "12:00:00", massTimeId: "time1", people: data.people, services: data.services, assignments: existing, allowMultipleServices: false, onGenerated: (value) => generated.push(value) }); tree.props.children[0].props.onClick(); },
    get message() { return hooks[1]; },
  };
}
const settle = () => new Promise(setImmediate);
test("confirmation cancellation preserves existing assignments and does not query or save", () => {
  const form = controlsHarness(false, { reading: ["manual"] }); form.click();
  assert.equal(form.requests.length, 0); assert.equal(form.generated.length, 0);
});
test("generation fills only the editable draft and reports success, with no save operation", async () => {
  const form = controlsHarness(); form.click(); assert.match(form.message, /Generando/);
  form.requests[0].resolve(form.data); await settle();
  assert.equal(form.generated[0].reading[0], "a"); assert.match(form.message, /Puedes modificarlas/);
  form.generated[0].reading[0] = "manual"; assert.equal(form.generated[0].reading[0], "manual");
});
test("a failed history request leaves existing assignments untouched", async () => {
  const form = controlsHarness(true, { reading: ["manual"] }); form.click();
  form.requests[0].reject(new Error("Network failed")); await settle();
  assert.equal(form.generated.length, 0); assert.match(form.message, /No se pudieron/);
});

test("double clicks cannot start concurrent generations", async () => {
  const form = controlsHarness(); form.click(); form.click();
  assert.equal(form.requests.length, 1);
  form.requests[0].resolve(form.data); await settle();
});
test("a cancelled lookup never replaces the editable draft", async () => {
  const form = controlsHarness(); form.click(); form.cancel();
  assert.equal(form.requests[0].args[3].aborted, true);
  form.requests[0].resolve(form.data); await settle();
  assert.equal(form.generated.length, 0); assert.match(form.message, /cancelada/);
});
test("no duplicate fallback is necessary even for overlapping authorization groups", () => {
  const data = input({ services: [service("x"), service("y"), service("z")], people: [person("a", ["x", "y"]), person("b", ["y", "z"]), person("c", ["x", "z"])] });
  const result = generateAssignments(data);
  assert.equal(new Set(Object.values(result.assignments).flat()).size, 3);
  assert.equal(result.reusedPersonIds.length, 0);
});

test("manual candidates exclude people assigned to another service unless multiple services are enabled", () => {
  const assignments = { reader: ["juan"], psalm: [""] };
  assert.equal(isAssignedToAnotherService(assignments, "psalm", "juan"), true);
  assert.equal(isAssignedToAnotherService(assignments, "reader", "juan"), false);
  assert.equal(isAssignedToAnotherService(assignments, "psalm", "maria"), false);
  assert.equal(canAssignToService(assignments, "psalm", "juan", false), false);
  assert.equal(canAssignToService(assignments, "psalm", "juan", true), true);
});

test("preview marks repeated people by id and only produces the note condition when needed", () => {
  const repeated = repeatedPersonIds({ reader: ["juan"], psalm: ["juan"], altar: ["maria"] });
  assert.deepEqual(plain([...repeated].sort()), ["juan"]);
  assert.equal(previewAssignmentNames(["juan", "maria"], (id) => id === "juan" ? "Juan Pérez" : "María López", repeated), "Juan Pérez * · María López");
  const noRepeated = repeatedPersonIds({ reader: ["juan"], psalm: ["maria"] });
  assert.equal(noRepeated.size, 0);
  assert.equal(previewAssignmentNames(["juan"], () => "Juan Pérez", noRepeated), "Juan Pérez");
});

test("preview helpers reflect generated draft assignments without saved data", () => {
  const before = previewAssignmentNames(["a"], (id) => id.toUpperCase(), repeatedPersonIds({ reader: ["a"] }));
  const generated = generateAssignments(input({ services: [service("reader"), service("psalm")], people: [person("a", ["reader"]), person("b", ["psalm"])] })).assignments;
  const after = previewAssignmentNames(generated.psalm, (id) => id.toUpperCase(), repeatedPersonIds(generated));
  assert.equal(before, "A");
  assert.equal(after, "B");
});

test("generated values appear in enabled selects and still call the manual edit handler", () => {
  const React = require("react");
  const Commissions = loadTs("../src/components/dashboard.tsx", {
    react: { ...React, useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useEffect: () => {} },
    "next/link": { default: () => null }, "next/navigation": {},
    "@/lib/supabase/client": { createClient: () => null },
    "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
    "@/lib/commission-assignments": { canAssignToService },
    "@/lib/commission-preview": { previewAssignmentNames, repeatedPersonIds },
  }, {}, "\nexport { Commissions };").Commissions;
  const generated = generateAssignments(input({ people: [person("a"), person("b")] })).assignments;
  const props = {
    path: "/comisiones/nueva", mass: { mass_date: "2026-10-18", mass_time_id: "time1", title: "Test", status: "draft" },
    categories: [{ id: "c", name: "Category" }], services: [{ ...service(), category_id: "c" }],
    massTimes: [], settings: {}, assignments: generated, query: "", canEdit: true, saved: "Pending",
    peopleFor: () => ["a", "b"].map((id) => ({ id, first_name: id, last_name: "", state: "Disponible" })),
    onChange: (s, index, value) => { generated[s.id][index] = value; },
  };
  function findSelect(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "select" && node.key === "reading-0") return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findSelect(child); if (found) return found;
    }
    return null;
  }
  const select = findSelect(Commissions(props));
  assert(select); assert.equal(select.props.disabled, false);
  assert.equal(select.props.value, generated.reading[0]);
  select.props.onChange({ target: { value: "manual" } });
  assert.equal(generated.reading[0], "manual");
  select.props.onChange({ target: { value: "" } });
  assert.equal(generated.reading[0], "");
});

test("PNG export uses the preview node dimensions with no fixed page height", () => {
  const dashboard = readFileSync(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /width: scrollWidth, height: scrollHeight/);
  assert.doesNotMatch(dashboard, /height: previewRef\.current\.scrollHeight/);
  const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.schedule-preview\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;/);
  assert.match(styles, /\.schedule-preview\s*\{[^}]*aspect-ratio:\s*auto;/);
});

const rules = loadTs("../src/lib/service-rules.ts");
const statuses = loadTs("../src/lib/commission-status.ts");
test("stable service identities define Todos and exact counts even after renaming", () => {
  assert.equal(rules.fixedServiceText(service("welcome", { stable_key: "bienvenida", name: "Renamed" })), "Todos");
  assert.equal(rules.getRequiredAssignmentCount(service("collection", { slug: "colecta" })), 4);
  assert.equal(rules.getRequiredAssignmentCount(service("offering", { stable_key: "ofrenda" })), 2);
  assert.equal(rules.getRequiredAssignmentCount(service("welcome", { slug: "bienvenida" })), 0);
});
test("welcome produces no person rows and auxiliary assignments never produce duplicates or stars", () => {
  const services = [service("welcome", { slug: "bienvenida" }), service("clean", { slug: "limpieza-hombres" }), service("reading")];
  const assignments = { welcome: ["a"], clean: ["a"], reading: ["a"] };
  assert.equal(rules.assignmentRows(assignments, services).some((r) => r.service_id === "welcome"), false);
  assert.equal(repeatedPersonIds(assignments, services).size, 0);
  assert.equal(canAssignToService({ clean: ["a"], welcome: ["a"] }, "reading", "a", false, services), true);
  assert.equal(previewAssignmentNames(["a"], () => "Ana", repeatedPersonIds(assignments, services)), "Ana");
});
test("autoassign fills four collection and two offering positions without repeats", () => {
  const services = [service("c", { slug: "colecta" }), service("o", { slug: "ofrenda" }), service("w", { slug: "bienvenida" }), service("l", { slug: "limpieza-mujeres" })];
  const data = input({ services, people: Array.from({ length: 6 }, (_, i) => person(String(i), ["c", "o", "w", "l"])) });
  const generated = generateAssignments(data).assignments;
  assert.equal(generated.c.length, 4); assert.equal(generated.o.length, 2);
  assert.equal(new Set(Object.values(generated).flat()).size, 6);
  assert.equal(generated.w, undefined); assert.equal(generated.l, undefined);
  const limited = generateAssignments({ ...data, people: [person("only", ["c", "o"])], allowMultipleServices: true }).assignments;
  assert.equal(limited.c.filter(Boolean).length, 1); assert.equal(limited.o.filter(Boolean).length, 1);
  assert.equal(limited.c.length, 4); assert.equal(limited.o.length, 2);
});
test("draft, cancelled and legacy unknown status are excluded; finished and published count", () => {
  for (const status of ["draft", "cancelled", null, "unknown"]) assert.equal(statuses.countsForRotation(status), false);
  for (const status of ["finished", "published"]) assert.equal(statuses.countsForRotation(status), true);
  const base = input({ people: [person("a"), person("b")], masses: [mass("m", "2026-10-17")], history: [{ mass_id: "m", person_id: "a", service_id: "reading" }] });
  assert.equal(generateAssignments(base).assignments.reading[0], "b");
  const empty = generateAssignments({ ...base, masses: [], history: [] }).assignments.reading[0];
  for (const status of ["draft", "cancelled"]) assert.equal(generateAssignments({ ...base, masses: [mass("m", "2026-10-17", { status })] }).assignments.reading[0], empty);
});
test("cleaning and welcome history do not penalize liturgical rotation", () => {
  const base = input({ services: [service(), service("l", { slug: "limpieza-mujeres" }), service("w", { slug: "bienvenida" })], people: [person("a"), person("b")], masses: [mass("m", "2026-10-17")] });
  const expected = generateAssignments(base).assignments.reading[0];
  const actual = generateAssignments({ ...base, history: ["l", "w"].map((service_id) => ({ mass_id: "m", person_id: expected, service_id })) });
  assert.equal(actual.assignments.reading[0], expected);
});
test("status labels and allowed transitions use compatible persisted enum values", () => {
  assert.equal(statuses.statusLabel("draft"), "Borrador");
  assert.equal(statuses.statusLabel("published"), "Confirmada");
  assert.equal(statuses.statusLabel("finished"), "Realizada");
  assert.equal(statuses.statusLabel("cancelled"), "Cancelada");
  assert.deepEqual(plain(statuses.statusTransitions("finished")), ["draft"]);
});

const dashboardComponents = loadTs("../src/components/dashboard.tsx", {
  "next/link": { default: () => null }, "next/navigation": {},
  "@/lib/supabase/client": { createClient: () => null },
  "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
}, {}, "\nexport { Commissions, WhatsAppScheduleImage }; ");
function previewProps(patch = {}) {
  return {
    mass: { mass_date: "2026-10-18", mass_time_id: "t", title: "Misa", status: "published" },
    massTimes: [], parish: { name: "Parroquia" }, settings: {}, previewRef: { current: null },
    categories: [{ id: "cat", name: "Servicios" }],
    services: [service("w", { slug: "bienvenida", category_id: "cat" }), service("c", { slug: "colecta", category_id: "cat" }), service("o", { slug: "ofrenda", category_id: "cat" }), service("l", { slug: "limpieza", category_id: "cat" })],
    assignments: { w: ["a"], c: ["a", "b", "c", "d"], o: ["e", "f"], l: ["a"] }, personName: (id) => id.toUpperCase(),
    ...patch,
  };
}
test("rendered preview shows Todos, all collection/offering slots, branding and each status", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  for (const status of ["draft", "published", "finished", "cancelled"]) {
    const props = previewProps(); props.mass.status = status;
    const html = renderToStaticMarkup(React.createElement(dashboardComponents.WhatsAppScheduleImage, props));
    assert(html.includes(statuses.statusLabel(status)));
    assert(html.includes("Todos"));
    for (const id of ["A", "B", "C", "D", "E", "F"]) assert(html.includes(`- ${id}`));
    assert(!html.includes("A *"));
    assert(html.includes("/images/santo-patrono.png")); assert(html.includes("/images/parish-logo.png"));
  }
});
test("rendered preview keeps the star for two liturgical roles but never marks cleaning", () => {
  const props = previewProps(); props.assignments.o = ["a", "f"];
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(dashboardComponents.WhatsAppScheduleImage, props));
  assert.equal((html.match(/A \*/g) ?? []).length, 2);
  assert(html.includes("* Servidor asignado a"));
});
test("form renders exactly four collection selects, two offering selects and incomplete notices", () => {
  const props = previewProps({ path: "/comisiones/nueva", canEdit: true, query: "", peopleFor: () => [], assignments: {}, saved: "Pending" });
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(dashboardComponents.Commissions, props));
  // Hour and status + 4 collection + 2 offering + 1 cleaning. Welcome has no select.
  assert.equal((html.match(/<select/g) ?? []).length, 9);
  assert(html.includes("Faltan 4 servidores para c."));
  assert(html.includes("Faltan 2 servidores para o."));
});
