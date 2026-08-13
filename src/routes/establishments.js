import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";

export const establishmentsRouter = Router();

// Listar (súper admin ve todos; otros ven el suyo)
establishmentsRouter.get("/", auth, async (req, res) => {
  const where = req.user.role === "superadmin" ? {} : { id: req.user.establishmentId || "" };
  const items = await prisma.establishment.findMany({ where, orderBy: { name: "asc" } });
  res.json(items);
});

// Crear (solo súper admin)
establishmentsRouter.post("/", auth, requireRole("superadmin"), async (req, res) => {
  const { name, rbd, comuna, type, sostenedor, students, ufPerStudent } = req.body || {};
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio." });
  const item = await prisma.establishment.create({
    data: { name, rbd: rbd || null, comuna, type: type || "basica", sostenedor, students: students || 0, ufPerStudent: ufPerStudent ?? 0.05 },
  });
  res.status(201).json(item);
});

// Actualizar (matrícula, tarifa, pago) — solo súper admin
establishmentsRouter.patch("/:id", auth, requireRole("superadmin"), async (req, res) => {
  const { students, ufPerStudent, paidUF, cumplimiento, name, rbd, comuna, sostenedor } = req.body || {};
  const item = await prisma.establishment.update({
    where: { id: req.params.id },
    data: { students, ufPerStudent, paidUF, cumplimiento, name, rbd, comuna, sostenedor },
  });
  res.json(item);
});
