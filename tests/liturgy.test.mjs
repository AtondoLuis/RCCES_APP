import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, overrides = {}, globals = {}, suffix = "") {
  const source = readFileSync(new URL(path, import.meta.url), "utf8") + suffix;
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports,
    require: (name) => name in overrides ? overrides[name] : require(name),
    fetch, AbortController, AbortSignal, Request, Response, URL, console, ...globals,
  });
  return testModule.exports;
}
const liturgy = loadTs("../src/lib/liturgy.ts");
const page = (title, date = "2026-07-26") => `<html><head><link rel="canonical" href="https://www.ewtn.com/es/lecturas/${date}"></head><body><div data-component="daily-readings-page-title">${title}</div></body></html>`;

test("validates real calendar dates before contacting the source", () => {
  for (const date of ["2026-07-26", "2028-02-29", "2026-01-01"]) assert.equal(liturgy.isLiturgicalDate(date), true);
  for (const date of ["", "26/07/2026", "2026-02-29", "2026-02-30", "2026-13-01", "2026-01-32", "2026-7-26", "https://example.com"]) assert.equal(liturgy.isLiturgicalDate(date), false);
});
test("extracts only the principal title and does not invent a subtitle", () => {
  const result = liturgy.parseEwtnLiturgy(page("XVII Domingo Ordinario"), "2026-07-26");
  assert.equal(result.celebration, "XVII Domingo Ordinario");
  assert.equal(result.subtitle, null);
  assert.equal(result.sourceUrl, "https://www.ewtn.com/es/lecturas/2026-07-26");
  assert.deepEqual(Object.keys(result).sort(), ["celebration", "source", "sourceUrl", "subtitle"]);
});
test("separates a solemnity from its Christmas octave base without duplicating context", () => {
  const title = "Octava de la Natividad: Solemnidad de la Sant\u00edsima Virgen Mar\u00eda, Madre de Dios";
  const result = liturgy.parseEwtnLiturgy(page(title, "2026-01-01"), "2026-01-01");
  assert.equal(result.celebration, "VIII d\u00eda de la Octava de Navidad");
  assert.equal(result.subtitle, title.split(": ")[1]);
});
test("decodes HTML entities and rejects missing titles or a different date", () => {
  assert.equal(liturgy.parseEwtnLiturgy(page("  Santos Marta, Mar&iacute;a y L&aacute;zaro (Memoria)  "), "2026-07-26").subtitle, "Santos Marta, Mar\u00eda y L\u00e1zaro (Memoria)");
  assert.throws(() => liturgy.parseEwtnLiturgy(page(""), "2026-07-26"));
  assert.throws(() => liturgy.parseEwtnLiturgy(page("Title", "2026-07-25"), "2026-07-26"));
  assert.throws(() => liturgy.parseEwtnLiturgy("<html>Unavailable</html>", "2026-07-26"));
});
test("upstream failures are rejected and requests have a timeout", async () => {
  const service = loadTs("../src/lib/liturgy.ts", {}, { fetch: async (url, options) => {
    assert.equal(url, "https://www.ewtn.com/es/lecturas/2026-07-26");
    assert(options.signal instanceof AbortSignal);
    return new Response("Unavailable", { status: 503 });
  } });
  await assert.rejects(service.getLiturgy("2026-07-26"));
});
test("API returns 400 without a lookup for invalid dates and 502 on source failure", async () => {
  let lookups = 0;
  const route = loadTs("../src/app/api/liturgia/route.ts", { "@/lib/liturgy": {
    isLiturgicalDate: liturgy.isLiturgicalDate,
    getLiturgy: async () => { lookups++; throw new Error("Network failure"); },
  } });
  assert.equal((await route.GET(new Request("http://localhost/api/liturgia?date=2026-02-30"))).status, 400);
  assert.equal(lookups, 0);
  assert.equal((await route.GET(new Request("http://localhost/api/liturgia?date=2026-07-26"))).status, 502);
  assert.equal(lookups, 1);
});
test("API success returns exactly the four requested fields", async () => {
  const expected = liturgy.parseEwtnLiturgy(page("XVII Domingo Ordinario"), "2026-07-26");
  const route = loadTs("../src/app/api/liturgia/route.ts", { "@/lib/liturgy": {
    isLiturgicalDate: liturgy.isLiturgicalDate, getLiturgy: async () => expected,
  } });
  const response = await route.GET(new Request("http://localhost/api/liturgia?date=2026-07-26"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), JSON.parse(JSON.stringify(expected)));
});

function formHarness() {
  let hookIndex = 0;
  const hooks = [], requests = [];
  let mass = { id: "m", mass_date: "2026-07-25", mass_time_id: "t", title: "Original", subtitle: "Old" };
  const React = require("react");
  const component = loadTs("../src/components/dashboard.tsx", {
    react: { ...React,
      useState: (value) => { const i = hookIndex++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], (v) => { hooks[i] = v; }]; },
      useRef: (value) => { const i = hookIndex++; return hooks[i] ??= { current: value }; },
      useEffect: () => {},
    },
    "next/link": { default: () => null }, "next/navigation": {},
    "@/lib/supabase/client": { createClient: () => null },
    "@/components/auto-assignment-controls": { AutoAssignmentControls: () => null },
  }, {
    window: { setTimeout, clearTimeout },
    fetch: (url, options) => new Promise((resolve) => requests.push({ url, options, resolve })),
  }, "\nexport { Commissions };").Commissions;
  function findDate(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "input" && node.props.type === "date") return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = findDate(child); if (result) return result; }
    return null;
  }
  return {
    requests,
    get mass() { return mass; },
    get status() { return hooks[4]; },
    manualTitle(title) { mass = { ...mass, title }; },
    manualSubtitle(subtitle) { mass = { ...mass, subtitle }; },
    changeDate(date) {
      hookIndex = 0;
      const tree = component({ path: "/comisiones/m/editar", mass, canEdit: true, massTimes: [], services: [], categories: [], settings: {}, assignments: {}, setMass: (update) => { mass = typeof update === "function" ? update(mass) : update; } });
      findDate(tree).props.onChange({ target: { value: date } });
    },
  };
}
const settle = () => new Promise(setImmediate);
test("date changes autofill only title/subtitle and preserve manual edits during a lookup", async () => {
  const form = formHarness();
  form.changeDate("2026-07-26");
  assert.match(form.status, /Cargando/);
  assert.equal(form.requests[0].url, "/api/liturgia?date=2026-07-26");
  form.manualTitle("Manual title");
  form.requests[0].resolve(Response.json({ celebration: "XVII Domingo Ordinario", subtitle: null }));
  await settle();
  assert.equal(form.mass.title, "Manual title");
  assert.equal(form.mass.subtitle, null);
  assert.equal(form.mass.mass_time_id, "t");
  assert.match(form.status, /cargada/);
});
test("a late response for an old date cannot replace the newest date", async () => {
  const form = formHarness();
  form.changeDate("2026-07-26"); form.changeDate("2026-07-27");
  assert.equal(form.requests[0].options.signal.aborted, true);
  form.requests[1].resolve(Response.json({ celebration: "Newest", subtitle: null })); await settle();
  form.requests[0].resolve(Response.json({ celebration: "Stale", subtitle: "Stale" })); await settle();
  assert.equal(form.mass.title, "Newest"); assert.equal(form.mass.mass_date, "2026-07-27");
});
test("clearing a date cancels pending results; failure leaves manual fields usable", async () => {
  const form = formHarness();
  form.changeDate("2026-07-26"); form.changeDate("");
  form.requests[0].resolve(Response.json({ celebration: "Stale", subtitle: null })); await settle();
  assert.equal(form.mass.title, "Original"); assert.equal(form.status, "");
  form.changeDate("2026-07-27"); form.requests[1].resolve(new Response("Unavailable", { status: 502 })); await settle();
  assert.equal(form.mass.title, "Original"); assert.match(form.status, /No se pudo/);
  form.manualTitle("Manual after failure"); assert.equal(form.mass.title, "Manual after failure");
});



test("required dates: ordinary Sunday, ferial Monday and Saint Teresa memorial", () => {
  const cases = [
    ["2026-07-26", "XVII Domingo Ordinario", "XVII Domingo Ordinario", null],
    ["2026-07-20", "Lunes de la XVI semana del tiempo ordinario", "Lunes de la XVI semana del tiempo ordinario", null],
    ["2026-10-15", "Santa Teresa de Jes\u00fas, Virgen, Doctora de la Iglesia (Memoria)", "Jueves de la XXVIII semana del tiempo ordinario", "Santa Teresa de Jes\u00fas, Virgen, Doctora de la Iglesia (Memoria)"],
  ];
  for (const [date, title, celebration, subtitle] of cases) {
    const result = liturgy.parseEwtnLiturgy(page(title, date), date);
    assert.equal(result.celebration, celebration, date);
    assert.equal(result.subtitle, subtitle, date);
    assert.equal(result.source, "EWTN");
  }
});
test("derives temporal weeks for Advent, Lent and Easter from the local calendar", () => {
  assert.equal(liturgy.baseLiturgicalDay("2026-12-08"), "Martes de la II semana de Adviento");
  assert.equal(liturgy.baseLiturgicalDay("2026-03-19"), "Jueves de la IV semana de Cuaresma");
  assert.equal(liturgy.baseLiturgicalDay("2026-05-01"), "Viernes de la IV semana de Pascua");
  assert.equal(liturgy.baseLiturgicalDay("2026-04-07"), "Martes de la Octava de Pascua");
  assert.equal(liturgy.baseLiturgicalDay("2026-02-20"), "Viernes despu\u00e9s de Ceniza");
  assert.equal(liturgy.baseLiturgicalDay("2025-08-20"), "Mi\u00e9rcoles de la XX semana del tiempo ordinario");
});
test("keeps temporal Sundays and moves feasts, optional memorials and unranked saints to subtitle", () => {
  for (const [date, title] of [["2026-11-29", "I Domingo de Adviento"], ["2026-03-01", "II Domingo de Cuaresma"], ["2026-03-29", "Domingo de Ramos"]]) {
    const result = liturgy.parseEwtnLiturgy(page(title, date), date);
    assert.equal(result.celebration, title); assert.equal(result.subtitle, null);
  }
  for (const [date, title] of [["2026-07-25", "Santiago, Ap\u00f3stol (Fiesta)"], ["2026-07-16", "Nuestra Se\u00f1ora del Carmen (Memoria Libre)"], ["2026-10-15", "Santa Teresa de Jes\u00fas"], ["2026-03-19", "San Jos\u00e9 (Solemnidad)"]]) {
    const result = liturgy.parseEwtnLiturgy(page(title, date), date);
    assert.notEqual(result.celebration, title); assert.equal(result.subtitle, title);
  }
});
test("autofills a nonempty subtitle while preserving a manual subtitle edit during a lookup", async () => {
  const form = formHarness();
  form.changeDate("2026-10-15");
  form.requests[0].resolve(Response.json({ celebration: "Jueves de la XXVIII semana del tiempo ordinario", subtitle: "Santa Teresa de Jes\u00fas (Memoria)" }));
  await settle();
  assert.equal(form.mass.title, "Jueves de la XXVIII semana del tiempo ordinario");
  assert.equal(form.mass.subtitle, "Santa Teresa de Jes\u00fas (Memoria)");
  form.changeDate("2026-10-16"); form.manualSubtitle("Custom subtitle");
  form.requests[1].resolve(Response.json({ celebration: "Viernes de la XXVIII semana del tiempo ordinario", subtitle: "New memorial" }));
  await settle();
  assert.equal(form.mass.subtitle, "Custom subtitle");
});

