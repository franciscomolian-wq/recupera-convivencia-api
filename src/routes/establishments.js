import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { isValidRbd, normalizeRbd, formatRbd } from "../lib/rut.js";

export const establishmentsRouter = Router();

// Devuelve el establecimiento con el RBD formateado para mostrar.
const withFmt = (e) => (e ? { ...e, rbd: e.rbd ? formatRbd(e.rbd) : null } : e);

// Listar (súper admin ve todos; otros ven el suyo)
establishmentsRouter.get("/", auth, async (req, res) => {
  const where = req.user.role === "superadmin" ? {} : { id: req.user.establishmentId || "" };
  const items = await prisma.establishment.findMany({ where, orderBy: { name: "asc" } });
  res.json(items.map(withFmt));
});

// Crear (solo súper admin) — RBD obligatorio, válido y único.
establishmentsRouter.post("/", auth, requireRole("superadmin"), async (req, res) => {
  const { name, rbd, comuna, type, sostenedor, students, ufPerStudent } = req.body || {};
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio." });
  if (!rbd || !String(rbd).trim()) return res.status(400).json({ error: "El RBD es obligatorio." });
  if (!isValidRbd(rbd)) return res.status(400).json({ error: "El RBD no es válido (revisa el dígito verificador)." });
  const nrbd = normalizeRbd(rbd);
  const dup = await prisma.establishment.findUnique({ where: { rbd: nrbd } });
  if (dup) return res.status(409).json({ error: "Ya existe un establecimiento con ese RBD." });
  const item = await prisma.establishment.create({
    data: { name, rbd: nrbd, comuna, type: type || "basica", sostenedor, students: students || 0, ufPerStudent: ufPerStudent ?? 0.05 },
  });
  res.status(201).json(withFmt(item));
});

// Actualizar (matrícula, tarifa, pago, RBD) — solo súper admin
establishmentsRouter.patch("/:id", auth, requireRole("superadmin"), async (req, res) => {
  const { students, ufPerStudent, paidUF, cumplimiento, name, rbd, comuna, sostenedor } = req.body || {};
  const data = { students, ufPerStudent, paidUF, cumplimiento, name, comuna, sostenedor };
  if (rbd !== undefined) {
    if (!rbd || !String(rbd).trim()) return res.status(400).json({ error: "El RBD es obligatorio." });
    if (!isValidRbd(rbd)) return res.status(400).json({ error: "El RBD no es válido (revisa el dígito verificador)." });
    const nrbd = normalizeRbd(rbd);
    const dup = await prisma.establishment.findUnique({ where: { rbd: nrbd } });
    if (dup && dup.id !== req.params.id) return res.status(409).json({ error: "Ya existe un establecimiento con ese RBD." });
    data.rbd = nrbd;
  }
  const item = await prisma.establishment.update({ where: { id: req.params.id }, data });
  res.json(withFmt(item));
});
