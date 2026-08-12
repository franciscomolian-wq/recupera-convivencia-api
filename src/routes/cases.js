import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../middleware/auth.js";

export const casesRouter = Router();

// Filtra por establecimiento salvo súper admin. Apoderado solo sus casos (pendiente enlazar).
function scopeFilter(user) {
  if (user.role === "superadmin") return {};
  return { establishmentId: user.establishmentId || "" };
}

const CASE_INCLUDE = { steps: { orderBy: { order: "asc" } }, derivations: true, evidence: true, emails: true, student: true };

// Listar casos con su etapa actual
casesRouter.get("/", auth, async (req, res) => {
  const cases = await prisma.case.findMany({ where: scopeFilter(req.user), include: CASE_INCLUDE, orderBy: { createdAt: "desc" } });
  res.json(cases);
});

// Detalle
casesRouter.get("/:id", auth, async (req, res) => {
  const c = await prisma.case.findUnique({ where: { id: req.params.id }, include: CASE_INCLUDE });
  if (!c) return res.status(404).json({ error: "Caso no encontrado." });
  res.json(c);
});

// Crear caso con sus pasos
casesRouter.post("/", auth, async (req, res) => {
  const { code, typeKey, studentLabel, level, relato, curso, fechaHecho, hora, lugar, testigos, adultosRef, studentId, steps } = req.body || {};
  if (!code || !typeKey || !studentLabel)
    return res.status(400).json({ error: "code, typeKey y studentLabel son obligatorios." });
  const c = await prisma.case.create({
    data: {
      code, typeKey, studentLabel, level: level || null, relato: relato || null,
      curso: curso || null, fechaHecho: fechaHecho || null, hora: hora || null, lugar: lugar || null, testigos: testigos || null, adultosRef: adultosRef || null,
      studentId: studentId || null,
      establishmentId: req.user.establishmentId || null,
      steps: { create: (steps || []).map((s, i) => ({ order: i, title: s.title, role: s.role, basis: s.basis, due: s.due ? new Date(s.due) : null })) },
    },
    include: CASE_INCLUDE,
  });
  res.status(201).json(c);
});

// Cerrar caso
casesRouter.post("/:id/close", auth, async (req, res) => {
  const c = await prisma.case.update({
    where: { id: req.params.id },
    data: { closed: true, closedAt: new Date(), closeSummary: req.body?.summary || "" },
    include: CASE_INCLUDE,
  });
  res.json(c);
});

// Adjuntar evidencia (metadatos)
casesRouter.post("/:id/evidence", auth, async (req, res) => {
  const { type, name, url, stepOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: "name es obligatorio." });
  const e = await prisma.evidence.create({ data: { caseId: req.params.id, type: type || "Otro", name, url: url || null, stepOrder: stepOrder ?? null } });
  res.status(201).json(e);
});

// Completar un paso (avanza la etapa actual)
casesRouter.post("/:id/steps/:order/done", auth, async (req, res) => {
  const order = Number(req.params.order);
  await prisma.step.updateMany({ where: { caseId: req.params.id, order }, data: { done: true } });
  const c = await prisma.case.update({
    where: { id: req.params.id },
    data: { currentStepIdx: order + 1 },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  res.json(c);
});

// Registrar una derivación
casesRouter.post("/:id/derivations", auth, async (req, res) => {
  const { label, email } = req.body || {};
  if (!label || !email) return res.status(400).json({ error: "label y email son obligatorios." });
  const d = await prisma.derivation.create({ data: { caseId: req.params.id, label, email } });
  res.status(201).json(d);
});

// Registrar envío de correo (log)
casesRouter.post("/:id/emails", auth, async (req, res) => {
  const { to, subject } = req.body || {};
  const m = await prisma.emailLog.create({ data: { caseId: req.params.id, to, subject } });
  res.status(201).json(m);
});
