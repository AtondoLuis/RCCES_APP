import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
function loader(overrides = {}, env = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: (name) => {
      if (name === 'server-only') return {};
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('./')) return load(resolve(dirname(file), name + '.ts'));
      return require(name);
    }, URL, URLSearchParams, Request, Response, AbortController, console, process: { env }, ...globals });
    return mod.exports;
  }
  return load;
}
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
function harness(role = 'ADMIN', active = true) {
  const profiles = [
    { id: uuid(1), role, active, parish_id: uuid(10), full_name: 'Admin', email: 'admin@example.test' },
    { id: uuid(2), role: 'LECTOR', active: true, parish_id: uuid(10), full_name: 'Reader', email: 'reader@example.test' },
    { id: uuid(3), role: 'ADMIN', active: true, parish_id: uuid(11), full_name: 'Foreign', email: 'foreign@example.test' },
  ];
  const records = { profiles, people: [{ id: uuid(20), parish_id: uuid(10), first_name: 'Juan', last_name: 'Perez' }, { id: uuid(21), parish_id: uuid(11), first_name: 'Ana', last_name: 'Other' }] };
  const calls = [], invitations = [];
  function from(table) {
    const call = { table, filters: [], patch: null, insert: null, range: null }; calls.push(call);
    function result(single) {
      let rows = (records[table] || []).filter((r) => call.filters.every(([key,value]) => r[key] === value));
      if (call.insert) { records[table].push(call.insert); rows = [call.insert]; }
      if (call.patch) rows.forEach((r) => Object.assign(r, call.patch));
      const count = rows.length;
      if (call.range) rows = rows.slice(call.range[0],call.range[1]+1);
      return { data: single ? rows[0] ?? null : rows, error: null, count };
    }
    return { select() { return this; }, eq(k,v) { call.filters.push([k,v]); return this; }, order() { return this; }, limit() { return this; }, range(a,b) { call.range=[a,b]; return this; },
      update(patch) { call.patch = patch; return this; }, insert(row) { call.insert=row; return this; }, maybeSingle() { return Promise.resolve(result(true)); },
      then(ok,bad) { return Promise.resolve(result(false)).then(ok,bad); } };
  }
  const client = { from, auth: { getUser: async () => ({ data: { user: role ? { id: uuid(1), user_metadata: { role: 'ADMIN', parish_id: uuid(11) } } : null }, error: null }) } };
  const admin = { from, auth: { admin: {
    getUserById: async (id) => ({ data: { user: { id, invited_at: '2026-10-17T12:00:00Z' } }, error: null }),
    inviteUserByEmail: async (email, options) => { invitations.push({ email, options }); return { data: { user: { id: uuid(50) } }, error: null }; },
  } } };
  const load = loader({ '@/lib/supabase/server': { createClient: async () => client }, '@/lib/supabase/admin': { createAdminClient: () => admin }, '@supabase/ssr': { createServerClient: () => client } }, { SUPABASE_SERVICE_ROLE_KEY: 'test-only', APP_URL: 'https://rcces.example', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public' });
  return { profiles, records, calls, invitations, client, load,
    route: load('src/app/api/admin/usuarios/route.ts'), access: load('src/lib/admin-access.ts') };
}
const body = (patch = {}) => ({ email: 'new@example.test', full_name: 'New User', role: 'LECTOR', active: true, person_id: null, ...patch });
const request = (method, value, origin = 'https://rcces.example') => new Request('https://rcces.example/api/admin/usuarios', { method, headers: { origin, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
for (const [role,status] of [['ADMIN',200],['COORDINADOR',403],['LECTOR',403],[null,401]]) {
  test(`users endpoint over HTTP: ${role ?? 'anonymous'} -> ${status}`, async () => {
    const h = harness(role);
    const server = createServer(async (req,res) => { const response = await h.route.GET(new Request('http://localhost' + req.url)); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); });
    await new Promise((ok) => server.listen(0,'127.0.0.1',ok));
    try { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/usuarios`); assert.equal(r.status,status); }
    finally { await new Promise((ok,bad) => server.close((e) => e ? bad(e) : ok())); }
  });
}
test('ADMIN invitation uses only trusted parish and prepares linked profile', async () => {
  const h = harness(); const r = await h.route.POST(request('POST',body({ person_id: uuid(20) })));
  assert.equal(r.status,201); assert.equal(h.invitations.length,1);
  const profile = h.profiles.find((p) => p.id === uuid(50));
  assert.equal(profile.parish_id,uuid(10)); assert.equal(profile.person_id,uuid(20));
  assert.equal(h.invitations[0].options.redirectTo,'https://rcces.example/auth/callback');
  assert.deepEqual(Object.keys(h.invitations[0].options.data),['full_name']);
});
test('arbitrary parish payload, foreign person and nonadmin invites are rejected before Auth admin API', async () => {
  const h = harness();
  assert.equal((await h.route.POST(request('POST',body({ parish_id: uuid(11) })))).status,400);
  assert.equal((await h.route.POST(request('POST',body({ person_id: uuid(21) })))).status,400);
  assert.equal(h.invitations.length,0);
  const coordinator = harness('COORDINADOR'); assert.equal((await coordinator.route.POST(request('POST',body()))).status,403);
  assert.equal(coordinator.invitations.length,0);
});
test('editing is tenant scoped and cannot change email or parish', async () => {
  const h = harness(); const values = body({ id: uuid(2), full_name: 'Updated', person_id: uuid(20) }); delete values.email;
  assert.equal((await h.route.PATCH(request('PATCH',values))).status,200);
  assert.equal(h.profiles[1].person_id,uuid(20)); assert.equal(h.profiles[1].full_name,'Updated');
  assert.equal((await h.route.PATCH(request('PATCH',{ ...values,id:uuid(3) }))).status,404);
  assert.equal((await h.route.PATCH(request('PATCH',{ ...values,email:'changed@example.test' }))).status,400);
  assert.equal((await h.route.PATCH(request('PATCH',{ ...values,parish_id:uuid(11) }))).status,400);
});
test('profile/person association cannot be duplicated', async () => {
  const h = harness(); h.profiles[1].person_id=uuid(20);
  assert.equal((await h.route.POST(request('POST',body({ person_id:uuid(20) })))).status,409);
  assert.equal(h.invitations.length,0);
});
test('inactive accounts are denied and reactivated accounts regain app access', async () => {
  const h = harness('ADMIN',false);
  assert.equal((await h.route.GET(request('GET'))).status,403);
  h.profiles[0].active=true; assert.equal((await h.route.GET(request('GET'))).status,200);
  const p = h.load('src/lib/permissions.ts');
  assert.equal(p.canUseApp({ role:'LECTOR',active:false,parish_id:uuid(10) }),false);
  assert.equal(p.canUseApp({ role:'LECTOR',active:true,parish_id:uuid(10) }),true);
});
test('CSRF origin, invalid JSON and unknown fields fail closed', async () => {
  const h = harness();
  assert.equal((await h.route.POST(request('POST',body(),'https://attacker.example'))).status,403);
  const invalid = new Request('https://rcces.example/api/admin/usuarios',{method:'POST',headers:{origin:'https://rcces.example'},body:'invalid'});
  assert.equal((await h.route.POST(invalid)).status,400);
  assert.equal(h.invitations.length,0);
});
for(const role of ['ADMIN','COORDINADOR','COORDINADOR_LITURGIA','LECTOR']) {
  test(`proxy enforces ADMIN on /admin/usuarios for ${role}`, async () => {
    const h=harness(role); const {NextRequest}=require('next/server');
    const r=await h.load('src/lib/supabase/proxy.ts').updateSession(new NextRequest('https://rcces.example/admin/usuarios'));
    assert.equal(r.status,role==='ADMIN'?200:403);
  });
}
test('proxy redirects anonymous users and blocks inactive sessions without a redirect loop',async()=>{
  const {NextRequest}=require('next/server');
  const anonymous=harness(null).load('src/lib/supabase/proxy.ts');
  const r=await anonymous.updateSession(new NextRequest('https://rcces.example/admin/usuarios'));
  assert.equal(r.status,307);assert.equal(r.headers.get('location'),'https://rcces.example/login');
  const inactive=harness('ADMIN',false).load('src/lib/supabase/proxy.ts');
  assert.equal((await inactive.updateSession(new NextRequest('https://rcces.example/login'))).status,200);
  assert.equal((await inactive.updateSession(new NextRequest('https://rcces.example/api/admin/usuarios'))).status,403);
  assert.equal((await inactive.updateSession(new NextRequest('https://rcces.example/auth/callback'))).status,200);
});
test('list never includes other parishes and pending invitation comes from Auth',async()=>{
  const h=harness();const r=await h.route.GET(request('GET'));const data=await r.json();
  assert.equal(data.users.length,2);assert(data.users.every((p)=>p.parish_id===uuid(10)));
  assert.equal(data.users[0].pending_invitation,true);
  assert.equal(data.users.some((p)=>'user_metadata' in p || 'access_token' in p),false);
});
test('service credential and admin SDK are server-only, no browser admin imports',()=>{
  const admin=readFileSync(resolve(root,'src/lib/supabase/admin.ts'),'utf8');
  assert.match(admin,/import "server-only"/); assert.match(admin,/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  for(const file of ['src/components/users-admin.tsx','src/components/dashboard.tsx','src/app/auth/callback/page.tsx','src/app/auth/password/page.tsx']) {
    const source=readFileSync(resolve(root,file),'utf8');
    assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_.*SERVICE|auth\.admin|@\/lib\/supabase\/admin|@\/lib\/user-admin/);
  }
});

function callbackHarness(active = true, href = 'https://rcces.example/auth/callback#access_token=access-test&refresh_token=refresh-test&type=invite') {
  const React = require('react'); const effects = [], errors = [], redirects = [], calls = [], cleaned = [];
  const reference = { current: null };
  const authResult = async (method) => { calls.push(method); return { error: null }; };
  const client = { auth: {
    setSession: () => authResult('setSession'), exchangeCodeForSession: () => authResult('exchangeCodeForSession'), verifyOtp: () => authResult('verifyOtp'),
    getUser: async () => ({ data: { user: { id: uuid(1) } }, error: null }), signOut: () => authResult('signOut'),
  }, from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { active, parish_id: uuid(10) }, error: null }) }) };
  const load = loader({ react: { ...React, useState: () => ['', (value) => errors.push(value)], useRef: () => reference, useEffect: (effect) => effects.push(effect) },
    'next/link': { default: () => null }, '@/lib/supabase/client': { createClient: () => client },
  }, {}, { window: { location: { href, replace: (url) => redirects.push(url) }, history: { replaceState: (_state,_title,url) => cleaned.push(url) } } });
  load('src/app/auth/callback/page.tsx').default();
  return { effects, errors, redirects, calls, cleaned };
}
test('invitation callback validates active profile and runs only once under Strict Mode',async()=>{
  const h=callbackHarness(); const cleanup=h.effects[0](); cleanup(); h.effects[0]();
  await new Promise(setImmediate);
  assert.deepEqual(h.calls,['setSession']); assert.deepEqual(h.redirects,['/auth/password']); assert.deepEqual(h.cleaned,['/auth/callback']); assert.equal(h.errors.length,0);
});
test('inactive invitation account is signed out and never enters the app',async()=>{
  const h=callbackHarness(false);h.effects[0](); await new Promise(setImmediate);
  assert(h.calls.includes('signOut')); assert.equal(h.redirects.length,0); assert.match(h.errors[0],/desactivado/);
});
for(const [query,method] of [['?code=code-test','exchangeCodeForSession'],['?token_hash=hash-test&type=invite','verifyOtp']]) {
  test(`callback supports ${method} without exposing tokens in the redirected URL`,async()=>{
    const h=callbackHarness(true,'https://rcces.example/auth/callback'+query);h.effects[0](); await new Promise(setImmediate);
    assert.deepEqual(h.calls,[method]); assert.deepEqual(h.redirects,['/auth/password']);
  });
}

test('admin users page waits for a request before rendering its authentication gate', async () => {
  let release;
  const requestReady = new Promise((resolve) => { release = resolve; });
  let authCalls = 0;
  const load = loader({
    'next/server': { connection: () => requestReady },
    '@/lib/admin-access': { AccessError: class extends Error {}, requireAdmin: async () => { authCalls++; } },
    '@/components/users-admin': { default: () => null },
  });
  let rendered = false;
  const tree = load('src/app/admin/usuarios/page.tsx').default();
  const gate = tree.props.children.type().then((content) => { rendered = true; return content; });
  await new Promise(setImmediate);
  assert.equal(rendered, false); assert.equal(authCalls, 0);
  release();
  await gate;
  assert.equal(authCalls, 1);
});

for(const status of ['draft','published','finished','cancelled']) {
  test(`lector direct URL with manipulated query is restricted for ${status}`, async () => {
    const h=harness('LECTOR');h.records.masses=[{id:uuid(90),parish_id:uuid(10),status}];
    const {NextRequest}=require('next/server');
    const response=await h.load('src/lib/supabase/proxy.ts').updateSession(new NextRequest(`https://rcces.example/comisiones/${uuid(90)}/preview?status=published&filter=all`));
    assert.equal(response.status,status==='published'?200:403);
  });
}
test('liturgy coordinator can open a commission but cannot use user or service administration APIs',async()=>{
  const h=harness('COORDINADOR_LITURGIA');h.records.masses=[{id:uuid(90),parish_id:uuid(10),status:'draft'}];
  const {NextRequest}=require('next/server');const proxy=h.load('src/lib/supabase/proxy.ts');
  for(const path of ['/comisiones','/comisiones/nueva',`/comisiones/${uuid(90)}/editar`]) assert.equal((await proxy.updateSession(new NextRequest('https://rcces.example'+path))).status,200);
  assert.equal((await h.route.POST(request('POST',body()))).status,403);
  const services=h.load('src/app/api/admin/servicios/route.ts');
  assert.equal((await services.PATCH(request('PATCH',{id:uuid(80),required_servers:3}))).status,403);
});
test('service API validates required_servers on the server and ADMIN can set three',async()=>{
  const h=harness();h.records.services=[{id:uuid(80),required_servers:1}];
  const services=h.load('src/app/api/admin/servicios/route.ts');
  for(const value of [0,-1,null,1.5]) assert.equal((await services.PATCH(request('PATCH',{id:uuid(80),required_servers:value}))).status,400);
  assert.equal((await services.PATCH(request('PATCH',{id:uuid(80),required_servers:3}))).status,200);
  assert.equal(h.records.services[0].required_servers,3);
});
test('ADMIN can assign the new role through existing user editing validation',async()=>{
  const h=harness();const value=body({id:uuid(2),role:'COORDINADOR_LITURGIA'});delete value.email;
  assert.equal((await h.route.PATCH(request('PATCH',value))).status,200);
  assert.equal(h.profiles[1].role,'COORDINADOR_LITURGIA');
});

test('invitation validation identifies the invalid field and accepts an unlinked coordinator', async () => {
  const invalidEmail = harness();
  const emailResponse = await invalidEmail.route.POST(request('POST', body({ email: 'ana@invalid' })));
  assert.equal(emailResponse.status, 400);
  assert.match((await emailResponse.json()).error, /email valido/);
  const invalidPerson = harness();
  const personResponse = await invalidPerson.route.POST(request('POST', body({ person_id: 'not-a-uuid' })));
  assert.equal(personResponse.status, 400);
  assert.match((await personResponse.json()).error, /servidor valido/);
  const valid = harness();
  const invitation = body({ full_name: 'Ana', role: 'COORDINADOR', person_id: '' });
  delete invitation.active;
  const response = await valid.route.POST(request('POST', invitation));
  assert.equal(response.status, 201);
  assert.equal(valid.invitations.length, 1);
  assert.equal(valid.profiles.find((profile) => profile.id === uuid(50)).person_id, null);
});

test('invitation accepts a linked server with a PostgreSQL-valid legacy UUID', async () => {
  const h = harness();
  const legacyId = '00000000-0000-0000-0000-000000000020';
  h.records.people.push({ id: legacyId, parish_id: uuid(10), first_name: 'Ana', last_name: 'Castelo' });
  const response = await h.route.POST(request('POST', body({
    full_name: 'Ana Castelo', email: 'anacastelorodelo@hotmail.com',
    role: 'COORDINADOR', person_id: legacyId,
  })));
  assert.equal(response.status, 201);
  assert.equal(h.profiles.find((profile) => profile.id === uuid(50)).person_id, legacyId);
});
