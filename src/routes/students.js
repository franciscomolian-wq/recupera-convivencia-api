import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { requirePerm, checkPerm, STUDENT_KIND_MODULE } from "../lib/permissions.js";

export const studentsRouter = Router();
const canManage = requireRole("superadmin", "coordinador", "director");
const canEditExp = requirePerm("expedientes", "editar");

function scope(user) {
  return user.role === "superadmin" ? {} : { establishmentId: user.establishmentId || "" };
}

const owns = (user, establishmentId) => user.role === "superadmin" || establishmentId === (user.establishmentId || "");

// Guarda: el expediente debe pertenecer al establecimiento del usuario.
async function requireStudentScope(req, res, next) {
  const s = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!s) return res.status(404).json({ error: "Expediente no encontrado." });
  if (!owns(req.user, s.establishmentId)) return res.status(403).json({ error: "No tienes acceso a este expediente." });
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
  const { name, curso, nivel, apoderadoNombre, apoderadoEmail } = req.body || {};
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio." });
  const s = await prisma.student.create({
    data: { name, curso, nivel, apoderadoNombre, apoderadoEmail, establishmentId: req.user.establishmentId || null },
  });
  audit(req, "student.create", { entity: "student", entityId: s.id, detail: name });
  res.status(201).json(s);
});

// Actualizar
studentsRouter.patch("/:id", auth, requireStudentScope, canEditExp, async (req, res) => {
  const data = pick(req.body, ["name", "curso", "nivel", "apoderadoNombre", "apoderadoEmail", "nee", "neeTipo"]);
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

// --- Registros genéricos del expediente (inspectoría, PIE, apoderados) ---
studentsRouter.post("/:id/records", auth, requireStudentScope, canEditRecordKind, async (req, res) => {
  const { kind, data } = req.body || {};
  if (!kind) return res.status(400).json({ error: "kind es obligatorio." });
  const r = await prisma.studentRecord.create({ data: { studentId: req.params.id, kind, data: data || {} } });
  res.status(201).json(r);
});
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
