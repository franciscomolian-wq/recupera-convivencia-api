import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../middleware/auth.js";

export const orgRouter = Router();

// Alcance: súper admin ve todo; el resto ve lo de su establecimiento + lo global (difusión).
function scope(user) {
  if (user.role === "superadmin") return {};
  return { OR: [{ establishmentId: user.establishmentId || "" }, { establishmentId: null }] };
}

// Listar registros (mensajes, eventos, gestiones, documentos, acciones PME)
orgRouter.get("/records", auth, async (req, res) => {
  const items = await prisma.orgRecord.findMany({ where: scope(req.user), orderBy: { createdAt: "desc" } });
  res.json(items);
});

// Crear
orgRouter.post("/records", auth, async (req, res) => {
  const { kind, data, global } = req.body || {};
  if (!kind) return res.status(400).json({ error: "kind es obligatorio." });
  // superadmin puede crear global (difusión); el resto siempre a su establecimiento.
  const establishmentId = req.user.role === "superadmin"
    ? (global ? null : (req.body.establishmentId || null))
    : (req.user.establishmentId || null);
  const r = await prisma.orgRecord.create({ data: { establishmentId, kind, data: data || {} } });
  res.status(201).json(r);
});

// Actualizar (merge de data)
orgRouter.patch("/records/:id", auth, async (req, res) => {
  const cur = await prisma.orgRecord.findUnique({ where: { id: req.params.id } });
  if (!cur) return res.status(404).json({ error: "Registro no encontrado." });
  const r = await prisma.orgRecord.update({ where: { id: req.params.id }, data: { data: { ...cur.data, ...(req.body.data || {}) } } });
  res.json(r);
});

// Eliminar
orgRouter.delete("/records/:id", auth, async (req, res) => {
  try { await prisma.orgRecord.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch { res.status(404).json({ error: "Registro no encontrado." }); }
});
