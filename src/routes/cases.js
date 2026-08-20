import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/permissions.js";
import { sendEmail, mailerConfigured, plainHtml } from "../lib/mailer.js";

export const casesRouter = Router();
const canEditCases = requirePerm("casos", "editar");
const canManage = requireRole("superadmin", "coordinador", "director");

// Filtra por establecimiento salvo súper admin. El apoderado solo ve los casos de su pupilo/a.
function scopeFilter(user) {
  if (user.role === "superadmin") return {};
  if (user.role === "apoderado") {
    const email = user.email || "__none__";
    return {
      establishmentId: user.establishmentId || "",
      OR: [
        { student: { apoderadoEmail: email } },
        { participants: { some: { student: { apoderadoEmail: email } } } },
      ],
    };
  }
  return { establishmentId: user.establishmentId || "" };
}

const CASE_INCLUDE = {
  steps: { orderBy: { order: "asc" } }, derivations: true, evidence: true, emails: true, student: true,
  participants: { include: { student: { select: { id: true, name: true, curso: true } } } },
};

// Descifra el relato (dato sensible) antes de enviar al cliente.
function decCase(c) {
  return c ? { ...c, relato: decrypt(c.relato) } : c;
}

// Guarda: el caso debe pertenecer al establecimiento del usuario (salvo súper admin).
async function requireCaseScope(req, res, next) {
  const c = await prisma.case.findUnique({
    where: { id: req.params.id },
    include: { student: true, participants: { include: { student: { select: { apoderadoEmail: true } } } } },
  });
  if (!c) return res.status(404).json({ error: "Caso no encontrado." });
  if (req.user.role !== "superadmin" && c.establishmentId !== (req.user.establishmentId || ""))
    return res.status(403).json({ error: "No tienes acceso a este caso." });
  if (req.user.role === "apoderado") {
    const email = req.user.email || "";
    const match = c.student?.apoderadoEmail === email || (c.participants || []).some((p) => p.student?.apoderadoEmail === email);
    if (!match) return res.status(403).json({ error: "No tienes acceso a este caso." });
  }
  req.caseRow = c;
  next();
}

// Listar casos con su etapa actual
casesRouter.get("/", auth, async (req, res) => {
  const cases = await prisma.case.findMany({ where: scopeFilter(req.user), include: CASE_INCLUDE, orderBy: { createdAt: "desc" } });
  res.json(cases.map(decCase));
});

// Detalle
casesRouter.get("/:id", auth, requireCaseScope, async (req, res) => {
  const c = await prisma.case.findUnique({ where: { id: req.params.id }, include: CASE_INCLUDE });
  if (!c) return res.status(404).json({ error: "Caso no encontrado." });
  res.json(decCase(c));
});

// Crear caso con sus pasos
casesRouter.post("/", auth, canEditCases, async (req, res) => {
  const { code, typeKey, studentLabel, level, relato, curso, fechaHecho, hora, lugar, testigos, adultosRef, studentId, steps, participants } = req.body || {};
  if (!code || !typeKey || !studentLabel)
    return res.status(400).json({ error: "code, typeKey y studentLabel son obligatorios." });

  // Valida que los estudiantes involucrados pertenezcan al establecimiento del usuario.
  const estId = req.user.establishmentId || null;
  let validParts = [];
  if (Array.isArray(participants) && participants.length) {
    const ids = [...new Set(participants.map((p) => p.studentId).filter(Boolean))];
    const owned = await prisma.student.findMany({
      where: { id: { in: ids }, ...(req.user.role === "superadmin" ? {} : { establishmentId: estId }) },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((s) => s.id));
    const seen = new Set();
    for (const p of participants) {
      if (!p.studentId || !ownedSet.has(p.studentId) || seen.has(p.studentId)) continue;
      seen.add(p.studentId);
      const role = ["afectado", "involucrado", "testigo"].includes(p.role) ? p.role : "involucrado";
      validParts.push({ studentId: p.studentId, role });
    }
  }
  // El estudiante "principal" (studentId del caso) = el afectado, o el primero de la lista.
  const primary = studentId || validParts.find((p) => p.role === "afectado")?.studentId || validParts[0]?.studentId || null;

  const c = await prisma.case.create({
    data: {
      code, typeKey, studentLabel, level: level || null, relato: relato ? encrypt(relato) : null,
      curso: curso || null, fechaHecho: fechaHecho || null, hora: hora || null, lugar: lugar || null, testigos: testigos || null, adultosRef: adultosRef || null,
      studentId: primary,
      establishmentId: estId,
      steps: { create: (steps || []).map((s, i) => ({ order: i, title: s.title, role: s.role, basis: s.basis, due: s.due ? new Date(s.due) : null })) },
      participants: validParts.length ? { create: validParts } : undefined,
    },
    include: CASE_INCLUDE,
  });
  audit(req, "case.create", { entity: "case", entityId: c.id, detail: `${code} · ${typeKey}${validParts.length ? ` · ${validParts.length} estudiantes` : ""}` });
  res.status(201).json(decCase(c));
});

// Cerrar caso
casesRouter.post("/:id/close", auth, requireCaseScope, canEditCases, async (req, res) => {
  const c = await prisma.case.update({
    where: { id: req.params.id },
    data: { closed: true, closedAt: new Date(), closeSummary: req.body?.summary || "" },
    include: CASE_INCLUDE,
  });
  audit(req, "case.close", { entity: "case", entityId: c.id, detail: c.code });
  res.json(decCase(c));
});

// Eliminar caso (arrastra pasos, evidencia, derivaciones y correos por cascada)
casesRouter.delete("/:id", auth, canManage, requireCaseScope, async (req, res) => {
  try {
    await prisma.case.delete({ where: { id: req.params.id } });
    audit(req, "case.delete", { entity: "case", entityId: req.params.id });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Caso no encontrado." });
  }
});

// Adjuntar evidencia (metadatos)
casesRouter.post("/:id/evidence", auth, requireCaseScope, canEditCases, async (req, res) => {
  const { type, name, url, stepOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: "name es obligatorio." });
  const e = await prisma.evidence.create({ data: { caseId: req.params.id, type: type || "Otro", name, url: url || null, stepOrder: stepOrder ?? null } });
  res.status(201).json(e);
});

// Completar un paso (avanza la etapa actual)
casesRouter.post("/:id/steps/:order/done", auth, requireCaseScope, canEditCases, async (req, res) => {
  const order = Number(req.params.order);
  await prisma.step.updateMany({ where: { caseId: req.params.id, order }, data: { done: true } });
  const c = await prisma.case.update({
    where: { id: req.params.id },
    data: { currentStepIdx: order + 1 },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  res.json(c);
});

// Registrar una derivación y ENVIAR el correo (oficio) a la institución.
casesRouter.post("/:id/derivations", auth, requireCaseScope, canEditCases, async (req, res) => {
  const { label, email, subject, body } = req.body || {};
  if (!label || !email) return res.status(400).json({ error: "label y email son obligatorios." });
  const c = req.caseRow || {};
  const asunto = subject || `Derivación de caso ${c.code || ""} · Convivencia escolar`;
  const texto = body || `Estimados ${label}:\n\nSe deriva a su institución el siguiente caso de convivencia escolar para su conocimiento y gestión según corresponda:\n\n• Código del caso: ${c.code || "-"}\n• Estudiante(s) / involucrados: ${c.studentLabel || "-"}\n\nQuedamos atentos a su respuesta.`;
  let sent = false;
  if (mailerConfigured()) {
    const r = await sendEmail({ to: email, subject: asunto, html: plainHtml({ heading: "Derivación de caso", bodyText: texto }) });
    sent = !!r.sent;
  }
  const d = await prisma.derivation.create({ data: { caseId: req.params.id, label, email } });
  if (sent) await prisma.emailLog.create({ data: { caseId: req.params.id, to: email, subject: asunto } });
  audit(req, "case.derive", { entity: "case", entityId: req.params.id, detail: `${label} <${email}>${sent ? " (correo enviado)" : ""}` });
  res.status(201).json({ ...d, sent });
});

// Notificar por correo (p. ej. al apoderado) — ENVÍA el correo y lo registra.
casesRouter.post("/:id/emails", auth, requireCaseScope, canEditCases, async (req, res) => {
  const { to, subject, body } = req.body || {};
  if (!to) return res.status(400).json({ error: "El destinatario (to) es obligatorio." });
  let sent = false;
  if (mailerConfigured()) {
    const r = await sendEmail({ to, subject: subject || "Aviso de convivencia escolar", html: plainHtml({ heading: "Aviso de convivencia escolar", bodyText: body || subject || "" }) });
    sent = !!r.sent;
  }
  const m = await prisma.emailLog.create({ data: { caseId: req.params.id, to, subject: subject || "" } });
  audit(req, "case.notify", { entity: "case", entityId: req.params.id, detail: `${to}${sent ? " (enviado)" : ""}` });
  res.status(201).json({ ...m, sent });
});
