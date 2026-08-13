// Pruebas de humo end-to-end contra la API (QA).
// Uso: TEST_API_URL=... TEST_RUT=... TEST_PASSWORD=... node --test tests/
// Por defecto apunta a producción y usa la cuenta demo coordinadora.
// Se autolimpia: elimina el caso y el estudiante que crea.
import { test, before } from "node:test";
import assert from "node:assert/strict";

const API = process.env.TEST_API_URL || "https://recupera-api-production.up.railway.app";
const RUT = process.env.TEST_RUT || "22.222.222-2";
const PASSWORD = process.env.TEST_PASSWORD || "demo1234";

let token;
const H = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + token });
const api = async (path, opts = {}) => {
  const res = await fetch(API + path, { ...opts, headers: { ...(opts.headers || {}), ...(opts.auth ? H() : { "Content-Type": "application/json" }) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

before(async () => {
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ rut: RUT, password: PASSWORD }) });
  assert.equal(r.status, 200, "login debe responder 200");
  token = r.body.token;
  assert.ok(token, "login debe devolver token");
});

test("health verifica la base de datos", async () => {
  const res = await fetch(API + "/health");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.db, "ok");
});

test("login rechaza RUT inexistente y clave incorrecta", async () => {
  const a = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ rut: "9.999.999-9", password: PASSWORD }) });
  assert.equal(a.status, 401);
  const b = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ rut: RUT, password: "malaclave" }) });
  assert.equal(b.status, 401);
});

test("rutas protegidas exigen token", async () => {
  const res = await fetch(API + "/api/cases");
  assert.equal(res.status, 401);
});

test("ciclo completo de caso: crear → listar → cerrar → eliminar (se autolimpia)", async () => {
  // crear estudiante
  const s = await api("/api/students", { method: "POST", auth: true, body: JSON.stringify({ name: "QA Automated Student", curso: "8°A", nivel: "basica" }) });
  assert.equal(s.status, 201);
  const studentId = s.body.id;

  try {
    // crear caso
    const code = "QA-TEST-" + Math.floor(Math.random() * 100000);
    const c = await api("/api/cases", { method: "POST", auth: true, body: JSON.stringify({
      code, typeKey: "bullying", studentLabel: "QA", level: "basica", studentId,
      steps: [{ title: "Acogida", role: "Coordinador", basis: "Ley 21.809" }],
    }) });
    assert.equal(c.status, 201, "crear caso");
    const caseId = c.body.id;

    // aparece en el listado
    const list = await api("/api/cases", { auth: true });
    assert.ok(list.body.some((x) => x.id === caseId), "el caso aparece en el listado");

    // cerrar
    const closed = await api(`/api/cases/${caseId}/close`, { method: "POST", auth: true, body: JSON.stringify({ summary: "QA" }) });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.closed, true);

    // registro de expediente
    const rec = await api(`/api/students/${studentId}/records`, { method: "POST", auth: true, body: JSON.stringify({ kind: "anotacion", data: { tipo: "positiva", descripcion: "QA" } }) });
    assert.equal(rec.status, 201);

    // limpieza del caso
    const delC = await api(`/api/cases/${caseId}`, { method: "DELETE", auth: true });
    assert.equal(delC.status, 200);
  } finally {
    // limpieza del estudiante (aunque falle algo arriba)
    await api(`/api/students/${studentId}`, { method: "DELETE", auth: true });
  }
});

test("auditoría registra eventos", async () => {
  const r = await api("/api/audit?limit=5", { auth: true });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});
