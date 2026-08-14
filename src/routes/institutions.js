import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";

export const institutionsRouter = Router();
const superadmin = requireRole("superadmin");

// Catálogo global de instituciones de derivación (lo consultan todos los perfiles).
institutionsRouter.get("/", auth, async (req, res) => {
  const items = await prisma.institution.findMany({ orderBy: { label: "asc" } });
  res.json(items);
});

institutionsRouter.post("/", auth, superadmin, async (req, res) => {
  const { label, type, email } = req.body || {};
  if (!label) return res.status(400).json({ error: "El nombre es obligatorio." });
  const item = await prisma.institution.create({ data: { label, type: type || null, email: email || null } });
  audit(req, "institution.create", { entity: "institution", entityId: item.id, detail: label });
  res.status(201).json(item);
});

institutionsRouter.patch("/:id", auth, superadmin, async (req, res) => {
  const { label, type, email } = req.body || {};
  try {
    const item = await prisma.institution.update({ where: { id: req.params.id }, data: { label, type, email } });
    res.json(item);
  } catch { res.status(404).json({ error: "Institución no encontrada." }); }
});

institutionsRouter.delete("/:id", auth, superadmin, async (req, res) => {
  try { await prisma.institution.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch { res.status(404).json({ error: "Institución no encontrada." }); }
});
