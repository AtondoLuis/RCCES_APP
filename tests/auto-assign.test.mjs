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
const { assignedMassServiceNames, canAssignToService, isAssignedToAnotherService } = loadTs("../src/lib/commission-assignments.ts", { "@/lib/auto-assign": { } });
const { previewAssignmentNames, repeatedPersonIds } = loadTs("../src/lib/commission-preview.ts", { "@/lib/auto-assign": { } });
const { countPeopleByStatus } = loadTs("../src/lib/dashboard-metrics.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const person = (id, services = ["reading"], patch = {}) => ({ id, parish_id: "p1", active: true, services, ...patch });
const service = (id = "reading", patch = {}) => ({ id, name: id, active: true, display_order: 1, allow_multiple_people: false, required_servers: 1, ...patch });
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
  const result = generateAssignments(input({ services: [service("one", { allow_multiple_people: true, required_servers: 2 }), service("two")], people: [person("a", ["one", "two"])], existingAssignments: { one: ["", ""] } }));
  assert.equal(result.assignments.one.filter(Boolean).length + result.assignments.two.filter(Boolean).length, 1);
  assert.deepEqual(plain(result.reusedPersonIds), []);
});
test("reuses a volunteer only when multiple services are enabled, never twice in the same service", () => {
  const result = generateAssignments(input({ allowMultipleServices: true, services: [service("one", { allow_multiple_people: true, required_servers: 2 }), service("two")], people: [person("a", ["one", "two"])], existingAssignments: { one: ["", ""] } }));
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
test("configured mass slots override the legacy multiple flag and current array length", () => {
  const data = input({ services: [service("reading", { allow_multiple_people: true })], people: [person("a"), person("b"), person("c")] });
  assert.equal(generateAssignments(data).assignments.reading.length, 1);
  assert.equal(generateAssignments({ ...data, existingAssignments: { reading: ["", ""] } }).assignments.reading.length, 1);
  assert.equal(generateAssignments({ ...data, services: [service("reading", { required_servers: 3 })] }).assignments.reading.length, 3);
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

function controlsHarness(confirm = true, existing = {}, patch = {}) {
  let hookIndex = 0;
  let cleanup;
  const hooks = [], generated = [], requests = [];
  const React = require("react");
  const data = input({ people: [person("a")], services: [service()], ...patch });
  const Controls = loadTs("../src/components/auto-assignment-controls.tsx", {
    react: { ...React,
      useMemo: (fn) => fn(),
      useEffect: (effect) => { cleanup ??= effect(); },
      useState: (initial) => { const i = hookIndex++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], (value) => { hooks[i] = value; }]; },
      useRef: (initial) => { const i = hookIndex++; return hooks[i] ??= { current: initial }; },
    },
    "@/lib/supabase/client": { createClient: () => ({}) },
    "@/lib/auto-assign": { generateMassServiceAssignments: generateAssignments },
    "@/lib/auto-assign-data": { loadAutoAssignData: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) },
  }, { window: { confirm: () => confirm, setTimeout, clearTimeout } }).AutoAssignmentControls;
  return { requests, generated, data,
    cancel() { cleanup?.(); },
    click(categoryId) { hookIndex = 0; const categories = [...new Set(data.services.map((item) => item.category_id).filter(Boolean))].map((id) => ({ id, name: id })); const tree = Controls({ parishId: "p1", date: "2026-10-18", time: "12:00:00", massTimeId: "time1", people: data.people, services: data.services, categories, assignments: existing, allowMultipleServices: false, onGenerated: (value) => generated.push(value) }); const button = categoryId ? tree.props.children[1].props.children.find((item) => item.key === categoryId) : tree.props.children[0]; button.props.onClick(); },
    get message() { return hooks[1]; },
    get warning() { return hooks[2]; },
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
    "@/lib/commission-assignments": { assignedMassServiceNames, canAssignToService },
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
  assert.equal(rules.getRequiredAssignmentCount(service("collection", { slug: "colecta", required_servers: 4 })), 4);
  assert.equal(rules.getRequiredAssignmentCount(service("offering", { stable_key: "ofrenda", required_servers: 2 })), 2);
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
  const services = [service("c", { slug: "colecta", required_servers: 4 }), service("o", { slug: "ofrenda", required_servers: 2 }), service("w", { slug: "bienvenida" }), service("l", { slug: "limpieza-mujeres" })];
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
  "next/link": () => null, "next/navigation": {},
  "@/lib/supabase/client": { createClient: () => null },
  "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
}, {}, "\nexport { Commissions, Home, WhatsAppScheduleImage }; ");
function previewProps(patch = {}) {
  return {
    mass: { mass_date: "2026-10-18", mass_time_id: "t", title: "Misa", status: "published" },
    massTimes: [], parish: { name: "Parroquia" }, settings: {}, previewRef: { current: null },
    categories: [{ id: "cat", name: "Servicios" }],
    services: [service("w", { slug: "bienvenida", category_id: "cat" }), service("c", { slug: "colecta", required_servers: 4, category_id: "cat" }), service("o", { slug: "ofrenda", required_servers: 2, category_id: "cat" }), service("l", { slug: "limpieza", category_id: "cat" })],
    assignments: { w: ["a"], c: ["a", "b", "c", "d"], o: ["e", "f"], l: ["a"] }, personName: (id) => id.toUpperCase(),
    ...patch,
  };
}
test("rendered preview shows Todos, collection/offering slots and branding without status", () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  for (const status of ["draft", "published", "finished", "cancelled"]) {
    const props = previewProps(); props.mass.status = status;
    const html = renderToStaticMarkup(React.createElement(dashboardComponents.WhatsAppScheduleImage, props));
    assert(!html.includes(statuses.statusLabel(status)));
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
  assert(html.includes("Faltan 4 servidores para completar c."));
  assert(html.includes("Faltan 2 servidores para completar o."));
});

const { generateCleaningAssignments } = loadTs("../src/lib/cleaning-assign.ts");
const cleanService = (id = "clean", patch = {}) => service(id, { slug: "limpieza-mujeres", allow_multiple_people: true, ...patch });
const cleaningInput = (patch = {}) => input({ services: [cleanService()], people: [person("a", ["clean"]), person("b", ["clean"])], cleaningHistory: [], ...patch });
test("cleaning uses authorization, active status, parish and date/time availability", () => {
  const data = cleaningInput({ people: [person("allowed", ["clean"]), person("other-time", ["clean"]), person("unauthorized"), person("inactive", ["clean"], { active: false }), person("foreign", ["clean"], { parish_id: "p2" }), person("day", ["clean"]), person("time", ["clean"])],
    existingAssignments: { clean: ["", "", "", ""] }, availability: [
      { person_id: "day", mass_date: "2026-10-18", mass_time_id: null, status: "unavailable" },
      { person_id: "time", mass_date: "2026-10-18", mass_time_id: "time1", status: "unavailable" },
      { person_id: "other-time", mass_date: "2026-10-18", mass_time_id: "other", status: "unavailable" },
    ] });
  const result = generateCleaningAssignments(data);
  assert.deepEqual(plain(result.assignments.clean.filter(Boolean).sort()), ["allowed", "other-time"]);
  assert.equal(result.assignments.clean.length, 4); assert.equal(result.missingCount, 2);
});
test("cleaning prioritizes the longest wait using only its own history", () => {
  const data = cleaningInput({ masses: [mass("recent", "2026-10-11"), mass("old", "2026-08-01")],
    cleaningHistory: [{ mass_id: "recent", person_id: "a", service_id: "clean" }, { mass_id: "old", person_id: "b", service_id: "clean" }],
    history: [{ mass_id: "recent", person_id: "b", service_id: "reading" }] });
  assert.equal(generateCleaningAssignments(data).assignments.clean[0], "b");
  assert.deepEqual(plain(generateCleaningAssignments({ ...data, history: [] })), plain(generateCleaningAssignments(data)));
});
test("fewer recent cleanings wins when the last cleaning date is equal", () => {
  const data = cleaningInput({ masses: [mass("last", "2026-10-11"), mass("extra", "2026-10-04")], cleaningHistory: [
    { mass_id: "last", person_id: "a", service_id: "clean" }, { mass_id: "last", person_id: "b", service_id: "clean" },
    { mass_id: "extra", person_id: "a", service_id: "clean" },
  ] });
  assert.equal(generateCleaningAssignments(data).assignments.clean[0], "b");
});
for (const status of ["draft", "cancelled", "published", "finished"]) {
  test(`cleaning rotation handles commission status ${status}`, () => {
    const base = cleaningInput();
    const first = generateCleaningAssignments(base).assignments.clean[0];
    const actual = generateCleaningAssignments({ ...base, masses: [mass("last", "2026-10-11", { status })], cleaningHistory: [{ mass_id: "last", person_id: first, service_id: "clean" }] }).assignments.clean[0];
    assert.equal(actual === first, status === "draft" || status === "cancelled");
  });
}
test("cleaning ignores current, future, foreign and unlinked history", () => {
  const base = cleaningInput({ massId: "current" });
  const first = generateCleaningAssignments(base).assignments.clean[0];
  const data = { ...base, masses: [mass("current", "2026-10-18", { time: "10:00:00" }), mass("future", "2026-10-19"), mass("foreign", "2026-10-11", { parish_id: "p2" })], cleaningHistory: ["current", "future", "foreign", null].map((mass_id) => ({ mass_id, person_id: first, service_id: "clean" })) };
  assert.equal(generateCleaningAssignments(data).assignments.clean[0], first);
});
test("existing cleaning slots are preserved and unique matching covers overlapping groups", () => {
  const data = cleaningInput({ services: [cleanService("one"), cleanService("two", { slug: "limpieza-hombres" })], people: [person("flex", ["one", "two"]), person("only", ["one"])], existingAssignments: { one: ["", ""], two: [""] } });
  const generated = generateCleaningAssignments(data);
  assert.equal(generated.assignments.one.length, 2); assert.equal(generated.assignments.two.length, 1);
  assert.equal(generated.assignments.two[0], "flex");
  assert.equal(generated.assignments.one.filter(Boolean)[0], "only"); assert.equal(generated.missingCount, 1);
  assert.deepEqual(plain(data.existingAssignments), { one: ["", ""], two: [""] });
});
test("same person can serve and clean when liturgical multiple services are disabled, with no star", () => {
  const data = input({ services: [service(), cleanService()], people: [person("a", ["reading", "clean"])], allowMultipleServices: false });
  const combined = { ...generateAssignments(data).assignments, ...generateCleaningAssignments(data).assignments };
  assert.equal(combined.reading[0], "a"); assert.equal(combined.clean[0], "a");
  assert.equal(repeatedPersonIds(combined, data.services).size, 0);
});
test("loader paginates cleaning_assignments and joins masses within the parish", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ mass_id: `m${i}`, person_id: "a", service_id: "clean" }));
  const client = queryClient({ cleaning_assignments: rows });
  const signal = new AbortController().signal;
  const loaded = await loadAutoAssignData(client, "p1", "2026-10-18", signal);
  assert.equal(loaded.cleaningHistory.length, 501); assert.equal(loaded.history.length, 0);
  const calls = client.calls.filter((call) => call.table === "cleaning_assignments");
  assert.equal(calls.length, 2);
  assert.match(calls[0].columns, /masses!inner/);
  assert(calls[0].filters.some(([, key, value]) => key === "parish_id" && value === "p1"));
  assert(calls[0].filters.some(([, key, value]) => key === "masses.parish_id" && value === "p1"));
  assert.equal(calls[0].signal, signal);
  await assert.rejects(loadAutoAssignData(queryClient({}, "cleaning_assignments"), "p1", "2026-10-18", signal), /Read failed/);
});
test("one autoassign click generates misa and cleaning and updates the editable preview", async () => {
  const services = [service("reading", { category_id: "cat" }), cleanService("clean", { category_id: "cat" })];
  const form = controlsHarness(true, {}, { services, people: [person("a", ["reading", "clean"])] });
  form.click(); assert.equal(form.requests.length, 1);
  form.requests[0].resolve(form.data); await settle();
  assert.equal(form.generated.length, 1);
  assert.equal(form.generated[0].reading[0], "a"); assert.equal(form.generated[0].clean[0], "a");
  const props = previewProps({ services, assignments: form.generated[0] });
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(dashboardComponents.WhatsAppScheduleImage, props));
  assert(html.includes("reading:")); assert(html.includes("clean:")); assert.equal((html.match(/ A/g) ?? []).length, 2); assert(!html.includes("A *"));
  form.generated[0].clean[0] = "manual"; assert.equal(form.generated[0].clean[0], "manual");
});
test("single-button autoassign reports cleaning shortages while preserving empty positions", async () => {
  const form = controlsHarness(true, { clean: ["", ""] }, { services: [cleanService()], people: [person("a", ["clean"])] });
  form.click(); form.requests[0].resolve(form.data); await settle();
  assert.equal(form.generated[0].clean.length, 2);
  assert.equal(form.generated[0].clean.filter(Boolean).length, 1);
  assert.match(form.warning, /Faltan 1 personas para Limpieza\./);
});

const filters = loadTs("../src/lib/list-filters.ts");
const permissions = loadTs("../src/lib/permissions.ts");
test("people status defaults to active and combines each option with text search", () => {
  const people = [{ active: true, first_name: "Ana", last_name: "Perez" }, { active: false, first_name: "Ana", last_name: "Lopez" }, { active: true, first_name: "Luis", last_name: "Perez" }];
  assert.equal(people.filter((p) => filters.matchesPeopleFilter(p)).length, 2);
  assert.equal(people.filter((p) => filters.matchesPeopleFilter(p, "Ana", "active")).length, 1);
  assert.equal(people.filter((p) => filters.matchesPeopleFilter(p, "Ana", "inactive")).length, 1);
  assert.equal(people.filter((p) => filters.matchesPeopleFilter(p, "", "all")).length, 3);
  assert.equal(people.filter((p) => filters.matchesPeopleFilter(p, "Perez", "inactive")).length, 0);
});
for (const role of ["ADMIN", "COORDINADOR", "COORDINADOR_LITURGIA", "LECTOR"]) {
  test(`${role} commission filters default to active without widening reader permissions`, () => {
    const rows = ["draft", "published", "finished", "cancelled"].map((status) => ({ status }));
    assert.deepEqual(plain(rows.filter((m) => filters.matchesCommissionFilter(m, role)).map((m) => m.status)), role === "LECTOR" ? ["published"] : ["draft", "published"]);
    assert.equal(rows.filter((m) => filters.matchesCommissionFilter(m, role, "all")).length, role === "LECTOR" ? 1 : 4);
    if (role === "LECTOR") for (const state of ["draft", "finished", "cancelled"]) assert.equal(rows.filter((m) => filters.matchesCommissionFilter(m, role, state)).length, 0);
  });
}
test("liturgy coordinator has explicit commission permissions but no administration or completed override", () => {
  const p = permissions.permissionsFor("COORDINADOR_LITURGIA");
  for (const key of ["viewCommissions", "createCommission", "editCommissions", "assignServices", "autoAssign", "confirmCommission"]) assert.equal(p[key], true);
  for (const key of ["manageUsers", "editPeople", "manageServices", "manageSchedules", "manageSettings", "reopenCompleted"]) assert.equal(p[key], false);
  for (const path of ["/admin/usuarios", "/admin/servicios", "/admin/horarios", "/admin/configuracion", "/servidores/nuevo", "/servidores/a/editar"]) assert.equal(permissions.canAccessPath("COORDINADOR_LITURGIA", path), false);
  for (const path of ["/comisiones", "/comisiones/nueva", "/comisiones/a/editar"]) assert.equal(permissions.canAccessPath("COORDINADOR_LITURGIA", path), true);
  assert.equal(permissions.permissionsFor("COORDINADOR").editPeople, true);
  assert(!statuses.statusTransitions("published", "COORDINADOR_LITURGIA").includes("finished"));
});
test("required_servers is independent of names and boolean multiple flags; special assignments stay special", () => {
  assert.equal(rules.getRequiredAssignmentCount({ id: "new" }), 1);
  assert.equal(rules.getRequiredAssignmentCount(service("s", { slug: "colecta", required_servers: 5 })), 5);
  assert.equal(rules.getRequiredAssignmentCount(service("s", { name: "Renamed", required_servers: 3, allow_multiple_people: false })), 3);
  for (const value of [0, -1, null, 1.5, NaN]) assert.equal(rules.isValidRequiredServers(value), false);
  assert.equal(rules.getRequiredAssignmentCount(service("s", { slug: "bienvenida", required_servers: 9 })), 0);
  assert.equal(rules.getRequiredAssignmentCount(cleanService("clean", { required_servers: 9 }), 2), 2);
});
test("new service with three slots is autoassigned and keeps unavailable slots blank without duplicates", () => {
  const data = input({ services: [service("three", { required_servers: 3 })], people: [person("a", ["three"]), person("b", ["three"]), person("c", ["three"])] });
  const full = generateAssignments(data).assignments.three;
  assert.equal(full.length, 3); assert.equal(new Set(full).size, 3);
  const limited = generateAssignments({ ...data, people: data.people.slice(0, 2) }).assignments.three;
  assert.equal(limited.length, 3); assert.equal(limited.filter(Boolean).length, 2); assert.equal(limited.filter((id) => !id).length, 1);
});
test("manual form renders exactly configured three slots even if legacy arrays were longer", () => {
  const props = previewProps({ path: "/comisiones/nueva", canEdit: true, query: "", peopleFor: () => [], services: [service("new", { required_servers: 3, category_id: "cat" })], assignments: { new: ["", "", "", ""] }, saved: "Pending" });
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(dashboardComponents.Commissions, props));
  assert.equal((html.match(/<select/g) ?? []).length, 5);
  assert(html.includes("Faltan 3 servidores para completar new."));
});
test("preview omits workflow status while retaining incidental status words in celebration text", () => {
  const props = previewProps(); props.mass.title = "Comunidad Confirmada";
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(dashboardComponents.WhatsAppScheduleImage, props));
  assert.equal((html.match(/Confirmada/g) ?? []).length, 1);
  assert(!html.includes("Borrador")); assert(html.includes("Santo Patrono"));
});

const ReactForLists = require("react");
const listComponents = loadTs("../src/components/dashboard.tsx", {
  "next/link": ({ children, ...props }) => ReactForLists.createElement("a", props, children),
  "next/navigation": { useRouter: () => ({ push: () => {} }) },
  "@/lib/supabase/client": { createClient: () => null },
  "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
}, {}, "\nexport { PeopleView, Commissions, Home, ServicesAdmin }; ");
test("server list renders an active-only initial view with a responsive status select", () => {
  const html = require("react-dom/server").renderToStaticMarkup(ReactForLists.createElement(listComponents.PeopleView, {
    parishId: "p1", canEdit: false, categories: [], services: [], reload: () => {}, people: [
      { id: "active", parish_id: "p1", first_name: "VisibleActive", last_name: "", active: true, services: [] },
      { id: "inactive", parish_id: "p1", first_name: "HiddenInactive", last_name: "", active: false, services: [] },
    ],
  }));
  assert(html.includes("VisibleActive")); assert(!html.includes("HiddenInactive"));
  assert(html.includes('aria-label="Estado de servidores"')); assert(html.includes('value="active" selected'));
});
test("commission list initially renders active commissions and keeps status outside the shared preview", () => {
  for (const role of ["ADMIN", "COORDINADOR_LITURGIA", "LECTOR"]) {
    const props = previewProps({ role, path: "/comisiones", canEdit: role !== "LECTOR", masses: ["draft", "published", "finished", "cancelled"].map((status) => ({ id: status, status, title: `Title-${status}`, mass_date: "2026-10-18", mass_time_id: "t" })) });
    const html = require("react-dom/server").renderToStaticMarkup(ReactForLists.createElement(listComponents.Commissions, props));
    assert(html.includes("Title-published")); assert.equal(html.includes("Title-draft"), role !== "LECTOR");
    assert(!html.includes("Title-finished")); assert(!html.includes("Title-cancelled")); assert(html.includes("Confirmada"));
  }
});
test("assignment labels list other liturgical services once and preserve multiple-service eligibility", () => {
  const services = [
    service("turiferario", { name: "Turiferario" }),
    service("colecta", { name: "Colecta", required_servers: 4 }),
    service("segunda", { name: "Segunda Lectura" }),
    service("clean", { name: "Limpieza", slug: "limpieza-mujeres" }),
    service("welcome", { name: "Bienvenida", slug: "bienvenida" }),
  ];
  const assignments = {
    turiferario: ["juan"],
    colecta: ["juan", "juan", "", ""],
    segunda: [""],
    clean: ["juan"],
    welcome: ["juan"],
  };
  assert.deepEqual(plain(assignedMassServiceNames(assignments, "segunda", "juan", services)), ["Turiferario", "Colecta"]);
  assert.deepEqual(plain(assignedMassServiceNames({}, "segunda", "juan", services)), []);
  assert.equal(canAssignToService(assignments, "segunda", "juan", false, services), false);
  assert.equal(canAssignToService(assignments, "segunda", "juan", true, services), true);
});

test("manual edits and autoassignment update rendered option labels from the current draft", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const services = [
    service("turiferario", { name: "Turiferario", category_id: "cat" }),
    service("segunda", { name: "Segunda Lectura", category_id: "cat" }),
  ];
  const renderForm = (assignments) => renderToStaticMarkup(React.createElement(dashboardComponents.Commissions, previewProps({
    path: "/comisiones/nueva",
    canEdit: true,
    query: "",
    saved: "Cambios pendientes",
    categories: [{ id: "cat", name: "Servicios" }],
    services,
    assignments,
    peopleFor: () => [{ id: "juan", first_name: "Juan", last_name: "Pérez", display_name: null, state: "Disponible" }],
  })));
  assert(renderForm({ turiferario: [""], segunda: [""] }).includes("Juan Pérez - Disponible"));
  assert(renderForm({ turiferario: ["juan"], segunda: [""] }).includes("Juan Pérez - Asignado a Turiferario"));
  assert(!renderForm({ turiferario: [""], segunda: [""] }).includes("Asignado a Turiferario"));

  const generated = generateAssignments(input({
    allowMultipleServices: true,
    services,
    people: [person("juan", ["turiferario", "segunda"])],
  })).assignments;
  const generatedHtml = renderForm(generated);
  assert(generatedHtml.includes("Juan Pérez - Asignado a Turiferario"));
  assert(generatedHtml.includes("Juan Pérez - Asignado a Segunda Lectura"));
});

test("dashboard server counts use current-parish data and render active and inactive totals", () => {
  const people = [
    { parish_id: "p1", active: true },
    { parish_id: "p1", active: true },
    { parish_id: "p1", active: false },
    { parish_id: "p1", active: false },
    { parish_id: "p2", active: true },
  ];
  assert.deepEqual(plain(countPeopleByStatus(people, "p1")), { active: 2, inactive: 2 });
  const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(dashboardComponents.Home, {
    masses: [],
    people,
    services: [],
    massTimes: [],
    parishId: "p1",
  }));
  assert(html.includes("2 activos · 2 inactivos"));
  assert(!html.includes("3 activos"));
  const source = readFileSync(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /from\("people"\).*?eq\("parish_id", ownerParishId\)/);
});

const { generateCommissionAssignments } = loadTs("../src/lib/assignment-generation.ts");
const { togglePreviewVisibility } = loadTs("../src/lib/preview-visibility.ts");

test("section reassignment replaces its slots, preserves other sections, and respects required servers", () => {
  const data = input({
    services: [service("reading", { category_id: "word", required_servers: 2 }), service("offering", { category_id: "altar" })],
    people: [person("a", ["reading", "offering"]), person("b", ["reading"]), person("c", ["reading"])],
    existingAssignments: { reading: ["a", "c"], offering: ["a"] },
  });
  const generated = generateCommissionAssignments(data, "word").assignments;
  assert.deepEqual(plain(generated.offering), ["a"]);
  assert.equal(generated.reading.length, 2);
  assert(!generated.reading.includes("a"));
  assert.deepEqual(plain(data.existingAssignments.reading), ["a", "c"]);
});

test("section reassignment can reuse outside volunteers only when multiple services is on", () => {
  const data = input({
    services: [service("reading", { category_id: "word" }), service("offering", { category_id: "altar" })],
    people: [person("a", ["reading", "offering"])],
    existingAssignments: { reading: ["old"], offering: ["a"] },
  });
  assert.equal(generateCommissionAssignments(data, "word").assignments.reading[0], "");
  assert.equal(generateCommissionAssignments({ ...data, allowMultipleServices: true }, "word").assignments.reading[0], "a");
  assert.equal(Object.values(generateCommissionAssignments(data).assignments).flat().filter(Boolean).length, 1);
});

test("section assignment uses the cleaning engine only for its own section", () => {
  const data = cleaningInput({
    services: [cleanService("clean", { category_id: "care", required_servers: 2 }), service("reading", { category_id: "word" })],
    people: [person("a", ["clean", "reading"]), person("b", ["clean"])],
    existingAssignments: { clean: ["old", "old"], reading: ["a"] },
  });
  const result = generateCommissionAssignments(data, "care").assignments;
  assert.deepEqual(plain(result.reading), ["a"]);
  assert.equal(result.clean.length, 2);
  assert.deepEqual(new Set(result.clean), new Set(["a", "b"]));
});

test("hiding a service or section changes the preview and restoring it recovers existing assignments", () => {
  const React = require("react");
  const render = (props) => require("react-dom/server").renderToStaticMarkup(React.createElement(dashboardComponents.WhatsAppScheduleImage, props));
  const props = previewProps({
    categories: [{ id: "word", name: "Palabra" }, { id: "altar", name: "Altar" }],
    services: [service("reading", { category_id: "word" }), service("offering", { category_id: "altar" })],
    assignments: { reading: ["a"], offering: ["b"] },
  });
  const initial = render(props);
  assert(initial.includes("A")); assert(initial.includes("B"));
  props.mass.preview_visibility = togglePreviewVisibility(null, "service", "reading");
  const serviceHidden = render(props);
  assert(!serviceHidden.includes("reading:")); assert(serviceHidden.includes("offering:"));
  assert.deepEqual(plain(props.assignments.reading), ["a"]);
  props.mass.preview_visibility = togglePreviewVisibility(props.mass.preview_visibility, "category", "altar");
  const sectionHidden = render(props);
  assert(!sectionHidden.includes("Altar")); assert(!sectionHidden.includes("offering:"));
  props.mass.preview_visibility = togglePreviewVisibility(props.mass.preview_visibility, "service", "reading");
  props.mass.preview_visibility = togglePreviewVisibility(props.mass.preview_visibility, "category", "altar");
  assert.equal(render(props), initial);
  assert.match(readFileSync(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8"), /toPng\(previewRef\.current/);
});

test("section control updates the editable draft without saving", async () => {
  const form = controlsHarness(true, { reading: ["manual"], offering: ["locked"] }, {
    services: [service("reading", { category_id: "word" }), service("offering", { category_id: "altar" })],
    people: [person("a", ["reading"]), person("b", ["offering"])],
  });
  form.click("word");
  form.requests[0].resolve(form.data);
  await settle();
  assert.equal(form.generated[0].reading[0], "a");
  assert.deepEqual(plain(form.generated[0].offering), ["locked"]);
});

test("section rotation ignores cleaning history outside the selected section", () => {
  const base = input({
    services: [service("reading", { category_id: "word" }), cleanService("clean", { category_id: "care" })],
    people: [person("a", ["reading", "clean"]), person("b", ["reading"])],
    masses: [mass("old", "2026-10-11")],
  });
  const first = generateCommissionAssignments(base, "word").assignments.reading[0];
  const withCleaning = { ...base, history: [{ mass_id: "old", person_id: first, service_id: "clean" }] };
  assert.equal(generateCommissionAssignments(withCleaning, "word").assignments.reading[0], first);
});

test("class filter covers all four classes, unassigned servers, and name search", () => {
  const ids = ["crecimiento-jovenes-1", "crecimiento-jovenes-2", "crecimiento-5", "crecimiento-4"];
  const people = ids.map((class_id, index) => ({ first_name: `Persona${index}`, last_name: "Clase", active: true, class_id }));
  people.push({ first_name: "Ana", last_name: "Libre", active: true, class_id: null });
  for (const [index, id] of ids.entries()) {
    assert.deepEqual(people.filter((person) => filters.matchesPeopleFilter(person, "", "active", id)).map((person) => person.first_name), [`Persona${index}`]);
  }
  assert.deepEqual(people.filter((person) => filters.matchesPeopleFilter(person, "", "active", "unassigned")).map((person) => person.first_name), ["Ana"]);
  assert.equal(people.filter((person) => filters.matchesPeopleFilter(person, "Ana", "active", "crecimiento-4")).length, 0);
  assert.equal(people.filter((person) => filters.matchesPeopleFilter(person, "Ana", "active", "unassigned")).length, 1);
});

test("server list and form expose compact class labels and the saved selection", () => {
  const render = (props) => require("react-dom/server").renderToStaticMarkup(ReactForLists.createElement(listComponents.PeopleView, props));
  const person = { id: "server-1", parish_id: "p1", first_name: "Ana", last_name: "Castelo", active: true, class_id: "crecimiento-jovenes-2", services: [] };
  const base = { parishId: "p1", canEdit: true, categories: [], services: [], reload: () => {}, people: [person] };
  const list = render(base);
  assert(list.includes("Crecimiento Jóvenes 2"));
  assert(list.includes("lg:grid-cols-["));
  assert(list.includes('aria-label="Filtrar por clase"'));
  assert(list.includes("Todas las clases") && list.includes("Sin asignar"));
  assert(!list.includes("overflow-x-auto"));
  const existing = render({ ...base, personId: "server-1" });
  assert.match(existing, /aria-label="Clase del servidor"[^>]*><option value="">Sin asignar<\/option><option value="crecimiento-jovenes-1"/);
  assert.match(existing, /value="crecimiento-jovenes-2" selected/);
  const fresh = render({ ...base, personId: "nuevo" });
  assert.match(fresh, /aria-label="Clase del servidor"[^>]*><option value="" selected="">Sin asignar/);
});

test("dashboard separates upcoming, completed, and cancelled commissions", () => {
  const html = require("react-dom/server").renderToStaticMarkup(ReactForLists.createElement(listComponents.Home, {
    masses: ["draft", "published", "finished", "cancelled"].map((status) => ({ id: status, title: `Mass-${status}`, status, mass_date: "2026-10-18", mass_time_id: "t" })),
    people: [], services: [], massTimes: [], parishId: "p1",
  }));
  for (const title of ["Próximas comisiones", "Realizadas", "Canceladas"]) assert(html.includes(title));
  const upcoming = html.indexOf("Próximas comisiones");
  const completed = html.indexOf("Realizadas");
  const cancelled = html.indexOf("Canceladas");
  assert(upcoming < html.indexOf("Mass-draft") && html.indexOf("Mass-published") < completed);
  assert(completed < html.indexOf("Mass-finished") && html.indexOf("Mass-finished") < cancelled);
  assert(cancelled < html.indexOf("Mass-cancelled"));
});

test("server form creates with a class and edits it without changing the server identity", async () => {
  const React = require("react");
  function exercise(personId, people, selectedClass) {
    const writes = [];
    const hooks = [];
    let index = 0;
    const client = { from(table) {
      if (table === "people") return {
        insert(row) { writes.push({ mode: "insert", row }); return { select: () => ({ single: async () => ({ data: { id: "new-server" }, error: null }) }) }; },
        update(row) { const entry = { mode: "update", row, filters: [] }; writes.push(entry); return { eq(key, value) { entry.filters.push([key, value]); return this; }, select: () => ({ single: async () => ({ data: { id: personId }, error: null }) }) }; },
      };
      return { delete: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) };
    } };
    const Component = loadTs("../src/components/dashboard.tsx", {
      react: { ...React, useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (value) => { hooks[slot] = value; }]; }, useEffect() {} },
      "next/link": ({ children }) => children,
      "next/navigation": { useRouter: () => ({ push() {} }) },
      "@/lib/supabase/client": { createClient: () => client },
      "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
    }, {}, "\nexport { PeopleView }; ").PeopleView;
    const props = { parishId: "p1", personId, canEdit: true, people, services: [], categories: [], reload: async () => {} };
    const render = () => { index = 0; return Component(props); };
    function find(node, match) {
      if (!node || typeof node !== "object") return null;
      if (match(node)) return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const found = find(child, match); if (found) return found;
      }
      return null;
    }
    const select = find(render(), (node) => node.props?.["aria-label"] === "Clase del servidor");
    assert(select);
    select.props.onChange({ target: { value: selectedClass } });
    const save = find(render(), (node) => node.type === "button" && node.props?.children === "Guardar");
    return { writes, save: () => save.props.onClick() };
  }
  const created = exercise("nuevo", [], "crecimiento-5");
  await created.save();
  assert.equal(created.writes[0].mode, "insert");
  assert.equal(created.writes[0].row.class_id, "crecimiento-5");

  const existing = { id: "server-1", parish_id: "p1", first_name: "Ana", last_name: "Castelo", class_id: "crecimiento-jovenes-1", services: [], active: true };
  const edited = exercise("server-1", [existing], "crecimiento-4");
  await edited.save();
  assert.equal(edited.writes[0].mode, "update");
  assert.equal(edited.writes[0].row.class_id, "crecimiento-4");
  assert.deepEqual(edited.writes[0].filters, [["id", "server-1"], ["parish_id", "p1"]]);
  assert.equal(existing.class_id, "crecimiento-jovenes-1");
});

test("server summary uses the selected state for both class count and denominator", () => {
  const { countPeopleSummary } = loadTs("../src/lib/dashboard-metrics.ts");
  const people = [
    { parish_id: "p1", active: true, class_id: "crecimiento-5" },
    { parish_id: "p1", active: true, class_id: "crecimiento-5" },
    { parish_id: "p1", active: true, class_id: null },
    { parish_id: "p1", active: false, class_id: "crecimiento-5" },
    { parish_id: "p2", active: true, class_id: "crecimiento-5" },
  ];
  const expected = [
    ["all", "all", 4, 4],
    ["crecimiento-5", "all", 4, 3],
    ["crecimiento-5", "active", 3, 2],
    ["crecimiento-5", "inactive", 1, 1],
    ["unassigned", "all", 4, 1],
    ["unassigned", "active", 3, 1],
    ["unassigned", "inactive", 1, 0],
    ["all", "inactive", 1, 1],
  ];
  for (const [classId, state, total, matchingClass] of expected) {
    assert.deepEqual(plain(countPeopleSummary(people, "p1", classId, state)), { active: 3, inactive: 1, total, matchingClass });
  }
  assert.deepEqual(plain(countPeopleSummary([], "p1", "crecimiento-5", "all")), { active: 0, inactive: 0, total: 0, matchingClass: 0 });
});

test("server summary ignores search, updates with filters and data, and keeps empty lists usable", () => {
  const React = require("react");
  const hooks = [];
  let index = 0;
  const Component = loadTs("../src/components/dashboard.tsx", {
    react: { ...React, useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (value) => { hooks[slot] = value; }]; }, useEffect() {} },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@/lib/supabase/client": { createClient: () => null },
    "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
  }, {}, "\nexport { PeopleView }; ").PeopleView;
  const props = {
    parishId: "p1", canEdit: false, categories: [], services: [], reload: () => {},
    people: [
      { id: "ana", parish_id: "p1", first_name: "Ana", last_name: "", email: "ana@example.test", active: true, class_id: "crecimiento-5", services: [] },
      { id: "bea", parish_id: "p1", first_name: "Bea", last_name: "", email: "bea@example.test", active: true, class_id: null, services: [] },
      { id: "cora", parish_id: "p1", first_name: "Cora", last_name: "", email: "cora@example.test", active: false, class_id: "crecimiento-5", services: [] },
      { id: "foreign", parish_id: "p2", first_name: "Foreign", last_name: "", active: true, class_id: "crecimiento-5", services: [] },
    ],
  };
  const render = () => { index = 0; const tree = Component(props); return { tree, html: require("react-dom/server").renderToStaticMarkup(tree) }; };
  function find(node, match) {
    if (!node || typeof node !== "object") return null;
    if (match(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = find(child, match); if (result) return result;
    }
    return null;
  }
  const change = (tree, key, value) => find(tree, (node) => node.props?.["aria-label"] === key || node.props?.placeholder === key).props.onChange({ target: { value } });
  let view = render();
  assert(view.html.includes("Activos: 2") && view.html.includes("Inactivos: 1"));
  assert(view.html.includes("2 servidores activos en total"));
  assert(!view.html.includes("Foreign"));
  change(view.tree, "Filtrar por clase", "crecimiento-5");
  view = render();
  assert(view.html.includes("1/2 servidores activos en esta clase"));
  assert(view.html.includes("Ana") && !view.html.includes("Bea") && !view.html.includes("Cora"));
  change(view.tree, "Estado de servidores", "all");
  view = render();
  assert(view.html.includes("2/3 servidores en esta clase"));
  change(view.tree, "Estado de servidores", "inactive");
  view = render();
  assert(view.html.includes("1/1 servidores inactivos en esta clase"));
  change(view.tree, "Nombre o email", "Nobody");
  view = render();
  assert(view.html.includes("No hay servidores que coincidan"));
  assert(view.html.includes("1/1 servidores inactivos en esta clase"));
  assert(view.html.includes("Activos: 2") && view.html.includes("Inactivos: 1"));
  change(view.tree, "Filtrar por clase", "all");
  view = render();
  assert(view.html.includes("1 servidores inactivos en total"));
  change(view.tree, "Estado de servidores", "all");
  change(render().tree, "Nombre o email", "ana@example.test");
  view = render();
  assert(view.html.includes("Ana") && !view.html.includes("Bea") && !view.html.includes("Cora"));
  assert(view.html.includes("3 servidores en total"));
  props.people = props.people.map((person) => person.id === "ana" ? { ...person, active: false, class_id: "crecimiento-4" } : person);
  view = render();
  assert(view.html.includes("Activos: 1") && view.html.includes("Inactivos: 2"));
  assert(view.html.includes("3 servidores en total"));
});

test("server rows keep navigation and four desktop columns with mobile wrapping", () => {
  const React = require("react");
  const html = require("react-dom/server").renderToStaticMarkup(React.createElement(listComponents.PeopleView, {
    parishId: "p1", canEdit: true, categories: [], services: [], reload: () => {},
    people: [{ id: "ana", parish_id: "p1", first_name: "Ana", last_name: "Castelo", email: "verylong@example.test", active: true, class_id: "crecimiento-jovenes-1", services: [] }],
  }));
  assert.match(html, /href="\/servidores\/ana"/);
  assert.match(html, /<b[^>]*>Ana Castelo<\/b>/);
  assert(html.includes("verylong@example.test") && html.includes("Crecimiento Jóvenes 1"));
  assert(html.includes("lg:grid-cols-[") && html.includes("grid-cols-[minmax(0,1fr)_auto]"));
  assert(html.includes("break-all") && html.includes("break-words") && html.includes("min-w-0"));
  assert(html.includes("Nuevo servidor"));
});

test("services show one explanatory note after the cards and preserve numeric controls", () => {
  const React = require("react");
  const html = require("react-dom/server").renderToStaticMarkup(React.createElement(listComponents.ServicesAdmin, {
    canAdmin: true, categories: [{ id: "cat", name: "Liturgia", display_order: 1 }],
    services: [service("one", { category_id: "cat" }), service("two", { category_id: "cat" })], reload: async () => {},
  }));
  const note = "Nota: Bienvenida usa Todos; Limpieza conserva sus plazas independientes.";
  assert.equal(html.split(note).length - 1, 1);
  assert.equal((html.match(/type="number" min="1" step="1" required=""/g) ?? []).length, 2);
  assert(html.lastIndexOf("service-card") < html.indexOf(note));
  assert(html.includes("Guardar") && html.includes("Desactivar"));
});
