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
test("keeps a solemnity as the main celebration without duplicating octave context", () => {
  const title = "Octava de la Natividad: Solemnidad de la Sant\u00edsima Virgen Mar\u00eda, Madre de Dios";
  const result = liturgy.parseEwtnLiturgy(page(title, "2026-01-01"), "2026-01-01");
  assert.equal(result.celebration, title.split(": ")[1]);
  assert.equal(result.subtitle, null);
});
test("decodes HTML entities and rejects missing titles or a different date", () => {
  assert.equal(liturgy.parseEwtnLiturgy(page("  Santos Marta, Mar&iacute;a y L&aacute;zaro (Memoria)  "), "2026-07-26").celebration, "Santos Marta, Mar\u00eda y L\u00e1zaro (Memoria)");
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


