import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";

export const auditRouter = Router();
const canView = requireRole("superadmin", "coordinador", "director", "sostenedor", "superintendencia");

// Listar eventos de auditoría (súper admin ve todo; el resto su establecimiento).
auditRouter.get("/", auth, canView, async (req, res) => {
  const where = req.user.role === "superadmin" ? {} : { establishmentId: req.user.establishmentId || "" };
  const take = Math.min(Number(req.query.limit) || 200, 500);
  const items = await prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, take });
  res.json(items);
});
