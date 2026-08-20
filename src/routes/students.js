import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { requirePerm, checkPerm, STUDENT_KIND_MODULE } from "../lib/permissions.js";
import { normalizeRut } from "../lib/rut.js";
import { sendEmail, mailerConfigured, plainHtml } from "../lib/mailer.js";
import crypto from "crypto";

const APP_URL = process.env.APP_URL || "https://app.recuperaconvivencia.cl";

export const studentsRouter = Router();
const canManage = requireRole("superadmin", "coordinador", "director");
const canEditExp = requirePerm("expedientes", "editar");

function scope(user) {
  if (user.role === "superadmin") return {};
  if (user.role === "apoderado")
    return { establishmentId: user.establishmentId || "", apoderadoEmail: user.email || "__none__" };
  return { establishmentId: user.establishmentId || "" };
}

const owns = (user, establishmentId) => user.role === "superadmin" || establishmentId === (user.establishmentId || "");

// Guarda: el expediente debe pertenecer al establecimiento del usuario.
async function requireStudentScope(req, res, next) {
  const s = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!s) return res.status(404).json({ error: "Expediente no encontrado." });
  if (!owns(req.user, s.establishmentId)) return res.status(403).json({ error: "No tienes acceso a este expediente." });
  if (req.user.role === "apoderado" && s.apoderadoEmail !== (req.user.email || ""))
    return res.status(403).json({ error: "No tienes acceso a este expediente." });
  next();
}

// Guarda: el registro (por rid) pertenece a un estudiante del establecimiento del usuario.
async function requireRecordScope(req, res, next) {
  const rec = await prisma.studentRecord.findUnique({ where: { id: req.params.rid }, include: { student: true } });
  if (!rec) return res.status(404).json({ error: "Registro no encontrado." });
  if (!owns(req.user, rec.student?.establishmentId)) return res.status(403).json({ error: "No tienes acceso a este registro." });
  req.recordRow = rec;
  next();
}

// Chequeo de permiso según el tipo de registro (inspectoría/PIE/apoderados).
async function canEditRecordKind(req, res, next) {
  const kind = req.body?.kind || req.recordRow?.kind;
  const mod = STUDENT_KIND_MODULE[kind] || "expedientes";
  if (await checkPerm(req.user, mod, "editar")) return next();
  res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción." });
}

const withRecords = {
  cases: { orderBy: { createdAt: "desc" } },
  entrevistas: { orderBy: { createdAt: "asc" } },
  citaciones: { orderBy: { createdAt: "asc" } },
  compromisos: { orderBy: { createdAt: "asc" } },
  medidas: { orderBy: { createdAt: "asc" } },
  records: { orderBy: { createdAt: "asc" } },
};

// Listar expedientes (con sus registros, para hidratar la UI de una vez)
studentsRouter.get("/", auth, async (req, res) => {
  const items = await prisma.student.findMany({ where: scope(req.user), include: withRecords, orderBy: { name: "asc" } });
  res.json(items);
});

// Detalle del expediente
studentsRouter.get("/:id", auth, requireStudentScope, async (req, res) => {
  const s = await prisma.student.findUnique({ where: { id: req.params.id }, include: withRecords });
  if (!s) return res.status(404).json({ error: "Expediente no encontrado." });
  res.json(s);
});

// Crear estudiante
studentsRouter.post("/", auth, canEditExp, async (req, res) => {
  const { name, rut, curso, nivel, grado, letra, genero, apoderadoNombre, apoderadoEmail } = req.body || {};
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio." });
  const cursoFinal = curso || ((grado || "") + (letra || "")) || null;
  const s = await prisma.student.create({
    data: { name, rut: rut ? normalizeRut(rut) : null, curso: cursoFinal, nivel, grado: grado || null, letra: letra || null, genero: genero || null, apoderadoNombre, apoderadoEmail, establishmentId: req.user.establishmentId || null },
  });
  audit(req, "student.create", { entity: "student", entityId: s.id, detail: name });
  res.status(201).json(s);
});

// Carga masiva desde nómina SIGE — crea/actualiza estudiantes del establecimiento.
// Es una acción de GESTIÓN (director/coordinador/superadmin), no de edición de expediente.
// Deduplica por RUN dentro del establecimiento; si ya existe, actualiza su curso.
// Optimizado para cientos de alumnos: una sola inserción masiva (createMany) para los nuevos.
studentsRouter.post("/bulk", auth, canManage, async (req, res) => {
  const list = Array.isArray(req.body?.students) ? req.body.students : null;
  if (!list) return res.status(400).json({ error: "Se espera un arreglo 'students'." });
  const estId = req.user.establishmentId || null;

  // Mapa de RUN → id de los estudiantes ya existentes en este establecimiento.
  const existing = await prisma.student.findMany({ where: { establishmentId: estId }, select: { id: true, rut: true } });
  const byRut = new Map(existing.filter((s) => s.rut).map((s) => [s.rut, s.id]));

  const toCreate = [];
  const toUpdate = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of list) {
    const name = String(raw?.name || "").trim();
    if (!name) { skipped++; continue; }
    const nrut = raw.rut ? normalizeRut(raw.rut) : null;
    if (nrut && seen.has(nrut)) { skipped++; continue; } // duplicado dentro del mismo archivo
    if (nrut) seen.add(nrut);
    const cursoFinal = raw.curso || ((raw.grado || "") + (raw.letra || "")) || null;
    const fields = { name, curso: cursoFinal, nivel: raw.nivel || null, grado: raw.grado || null, letra: raw.letra || null, genero: raw.genero || null };
    if (nrut && byRut.has(nrut)) toUpdate.push({ id: byRut.get(nrut), fields });
    else toCreate.push({ ...fields, rut: nrut, establishmentId: estId });
  }

  if (toCreate.length) await prisma.student.createMany({ data: toCreate });
  // Las actualizaciones (solo en reimportaciones) van una a una, pero son pocas.
  for (const u of toUpdate) await prisma.student.update({ where: { id: u.id }, data: u.fields });

  audit(req, "student.bulk", { entity: "student", detail: `${toCreate.length} creados, ${toUpdate.length} actualizados, ${skipped} omitidos` });
  res.json({ created: toCreate.length, updated: toUpdate.length, skipped, total: list.length });
});

// Actualizar
studentsRouter.patch("/:id", auth, requireStudentScope, canEditExp, async (req, res) => {
  const data = pick(req.body, ["name", "rut", "curso", "nivel", "grado", "letra", "genero", "apoderadoNombre", "apoderadoEmail", "nee", "neeTipo"]);
  if (data.rut !== undefined) data.rut = data.rut ? normalizeRut(data.rut) : null;
  if ((data.grado !== undefined || data.letra !== undefined) && data.curso === undefined) {
    const cur = await prisma.student.findUnique({ where: { id: req.params.id } });
    data.curso = (data.grado ?? cur?.grado ?? "") + (data.letra ?? cur?.letra ?? "") || null;
  }
  const s = await prisma.student.update({ where: { id: req.params.id }, data });
  res.json(s);
});

// Eliminar expediente (bloquea si tiene casos asociados)
studentsRouter.delete("/:id", auth, canManage, requireStudentScope, async (req, res) => {
  const casos = await prisma.case.count({ where: { studentId: req.params.id } });
  if (casos > 0) return res.status(409).json({ error: "El estudiante tiene casos asociados. Elimínalos primero." });
  try {
    await prisma.student.delete({ where: { id: req.params.id } });
    audit(req, "student.delete", { entity: "student", entityId: req.params.id });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Expediente no encontrado." });
  }
});

// Agregar registros del expediente
studentsRouter.post("/:id/entrevistas", auth, requireStudentScope, canEditExp, async (req, res) => {
  const r = await prisma.entrevista.create({ data: { studentId: req.params.id, ...pick(req.body, ["fecha", "con", "resumen", "foto"]) } });
  res.status(201).json(r);
});
studentsRouter.post("/:id/citaciones", auth, requireStudentScope, canEditExp, async (req, res) => {
  const r = await prisma.citacion.create({ data: { studentId: req.params.id, ...pick(req.body, ["fecha", "motivo", "estado", "excusa"]) } });
  res.status(201).json(r);
});
studentsRouter.post("/:id/compromisos", auth, requireStudentScope, canEditExp, async (req, res) => {
  const { texto } = req.body || {};
  if (!texto) return res.status(400).json({ error: "texto es obligatorio." });
  const r = await prisma.compromiso.create({ data: { studentId: req.params.id, texto } });
  res.status(201).json(r);
});
studentsRouter.patch("/compromisos/:cid", auth, canEditExp, async (req, res) => {
  const cur = await prisma.compromiso.findUnique({ where: { id: req.params.cid }, include: { student: true } });
  if (!cur) return res.status(404).json({ error: "Compromiso no encontrado." });
  if (!owns(req.user, cur.student?.establishmentId)) return res.status(403).json({ error: "Sin acceso." });
  const r = await prisma.compromiso.update({ where: { id: req.params.cid }, data: { cumplido: !!req.body.cumplido } });
  res.json(r);
});
studentsRouter.post("/:id/medidas", auth, requireStudentScope, canEditExp, async (req, res) => {
  const r = await prisma.medida.create({ data: { studentId: req.params.id, ...pick(req.body, ["tipo", "descripcion", "fecha"]) } });
  res.status(201).json(r);
});

// --- Confirmación pública de citación por el apoderado (vía enlace del correo, sin login) ---
async function findCitacionByToken(token) {
  if (!token) return null;
  return prisma.studentRecord.findFirst({
    where: { kind: "citacionApo", data: { path: ["token"], equals: token } },
    include: { student: true },
  });
}
studentsRouter.get("/citacion/:token", async (req, res) => {
  const rec = await findCitacionByToken(req.params.token);
  if (!rec) return res.status(404).json({ error: "Citación no encontrada o enlace vencido." });
  const d = rec.data || {};
  res.json({ motivo: d.motivo || "", fecha: d.fecha || "", hora: d.hora || "", estado: d.estado || "Pendiente", apoderado: rec.student?.apoderadoNombre || "", studentName: rec.student?.name || "", confirmed: !!d.firma });
});
studentsRouter.post("/citacion/:token/confirm", async (req, res) => {
  const rec = await findCitacionByToken(req.params.token);
  if (!rec) return res.status(404).json({ error: "Citación no encontrada o enlace vencido." });
  const d = rec.data || {};
  if (d.firma) return res.json({ ok: true, already: true });
  const firma = { por: rec.student?.apoderadoNombre || "Apoderado/a", at: new Date().toISOString().slice(0, 10), via: "enlace" };
  await prisma.studentRecord.update({ where: { id: rec.id }, data: { data: { ...d, estado: "Confirmada", firma } } });
  res.json({ ok: true });
});

// --- Registros genéricos del expediente (inspectoría, PIE, apoderados) ---
studentsRouter.post("/:id/records", auth, requireStudentScope, canEditRecordKind, async (req, res) => {
  const { kind, data } = req.body || {};
  if (!kind) return res.status(400).json({ error: "kind es obligatorio." });
  let recData = data || {};
  let mailTo = null, studentName = "", apoNombre = "";
  // Citación de apoderado: prepara token de confirmación y datos para el correo.
  if (kind === "citacionApo") {
    const stu = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (stu?.apoderadoEmail) {
      recData = { ...recData, token: crypto.randomBytes(24).toString("hex") };
      mailTo = stu.apoderadoEmail; studentName = stu.name || ""; apoNombre = stu.apoderadoNombre || "";
    }
  }
  const r = await prisma.studentRecord.create({ data: { studentId: req.params.id, kind, data: recData } });
  // Envía el correo de citación al apoderado con el enlace de confirmación.
  if (mailTo && mailerConfigured()) {
    const link = `${APP_URL}/?citacion=${recData.token}`;
    const mail = await sendEmail({ to: mailTo, subject: `Citación de apoderado · ${studentName}`, html: citacionHtml({ apoNombre, studentName, recData, link }) });
    if (mail.sent) { await prisma.studentRecord.update({ where: { id: r.id }, data: { data: { ...recData, emailSent: true } } }); r.data = { ...recData, emailSent: true }; }
  }
  // Reconocimiento de convivencia positiva: correo de felicitación a la familia.
  let reconSent = false;
  if (kind === "reconocimiento" && recData.avisarFamilia !== false && mailerConfigured()) {
    const stu = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (stu?.apoderadoEmail) {
      const mail = await sendEmail({ to: stu.apoderadoEmail, subject: `¡Un reconocimiento para ${stu.name}! · Convivencia positiva`, html: reconocimientoHtml({ apoNombre: stu.apoderadoNombre, studentName: stu.name, recData }) });
      reconSent = !!mail.sent;
      if (reconSent) { await prisma.studentRecord.update({ where: { id: r.id }, data: { data: { ...recData, emailSent: true } } }); r.data = { ...recData, emailSent: true }; }
    }
  }
  res.status(201).json({ ...r, emailSent: !!((mailTo && r.data?.emailSent) || reconSent) });
});

function reconocimientoHtml({ apoNombre, studentName, recData }) {
  const cat = recData.categoriaLabel || "Convivencia positiva";
  const emoji = recData.categoriaEmoji || "🌟";
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#3C4043">
    <div style="background:#1E8E3E;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:17px;font-weight:600">Recupera Convivencia</div>
      <div style="font-size:12px;opacity:.9;letter-spacing:1px;text-transform:uppercase">Reconocimiento de convivencia positiva</div>
    </div>
    <div style="border:1px solid #DADCE0;border-top:none;border-radius:0 0 12px 12px;padding:24px;font-size:14px;line-height:1.6">
      <p style="font-size:16px;margin:0 0 6px 0">${emoji} <b>¡Felicitaciones!</b></p>
      <p>Estimado/a ${apoNombre || "apoderado/a"}:</p>
      <p>Nos alegra informarle que <b>${studentName}</b> ha recibido un reconocimiento en nuestro establecimiento por:</p>
      <div style="background:#E6F4EA;border:1px solid #b7e0c3;border-radius:8px;padding:14px 16px;margin:12px 0">
        <div style="font-weight:700;color:#1E8E3E;font-size:15px">${emoji} ${cat}</div>
        ${recData.descripcion ? `<div style="margin-top:6px;color:#3C4043">${String(recData.descripcion).replace(/[<>]/g, "")}</div>` : ""}
      </div>
      <p>Agradecemos su acompañamiento y compromiso con el buen trato y la sana convivencia. ¡Sigamos reconociendo lo positivo!</p>
      <p style="font-size:11px;color:#5F6368;margin-top:18px">Enviado por la plataforma de convivencia escolar del establecimiento. No responda a esta dirección.</p>
    </div>
  </div>`;
}

function citacionHtml({ apoNombre, studentName, recData, link }) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#3C4043">
    <div style="background:#1A73E8;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:17px;font-weight:600">Recupera Convivencia</div>
      <div style="font-size:12px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Citación de apoderado</div>
    </div>
    <div style="border:1px solid #DADCE0;border-top:none;border-radius:0 0 12px 12px;padding:22px;font-size:14px;line-height:1.55">
      <p>Estimado/a ${apoNombre || "apoderado/a"}:</p>
      <p>Se le cita a una reunión en el establecimiento por el/la estudiante <b>${studentName}</b>.</p>
      <table style="font-size:14px;border-collapse:collapse;margin:10px 0">
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Motivo</td><td><b>${recData.motivo || "-"}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Fecha</td><td><b>${recData.fecha || "por confirmar"}</b></td></tr>
        ${recData.hora ? `<tr><td style="padding:2px 12px 2px 0;color:#5F6368">Hora</td><td><b>${recData.hora}</b></td></tr>` : ""}
      </table>
      <p style="text-align:center;margin:24px 0">
        <a href="${link}" style="background:#1A73E8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;display:inline-block">Confirmar asistencia</a>
      </p>
      <p style="font-size:12px;color:#5F6368">Si el botón no funciona, copia y pega este enlace:<br><span style="word-break:break-all;color:#1A73E8">${link}</span></p>
      <p style="font-size:12px;color:#5F6368">Si no puede asistir, comuníquese con el establecimiento para reagendar.</p>
    </div>
  </div>`;
}
studentsRouter.patch("/records/:rid", auth, requireRecordScope, canEditRecordKind, async (req, res) => {
  const cur = await prisma.studentRecord.findUnique({ where: { id: req.params.rid } });
  if (!cur) return res.status(404).json({ error: "Registro no encontrado." });
  const r = await prisma.studentRecord.update({ where: { id: req.params.rid }, data: { data: { ...cur.data, ...(req.body.data || {}) } } });
  res.json(r);
});
studentsRouter.delete("/records/:rid", auth, requireRecordScope, canEditRecordKind, async (req, res) => {
  try { await prisma.studentRecord.delete({ where: { id: req.params.rid } }); res.json({ ok: true }); }
  catch { res.status(404).json({ error: "Registro no encontrado." }); }
});

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
