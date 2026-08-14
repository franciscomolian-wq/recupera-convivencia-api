import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../middleware/auth.js";
import { checkPerm, ORG_KIND_MODULE } from "../lib/permissions.js";

export const orgRouter = Router();

// Permiso para operar un registro según su tipo (kind).
async function canEditOrgKind(user, kind) {
  if (kind === "permset") return ["superadmin", "coordinador", "director"].includes(user.role);
  const mod = ORG_KIND_MODULE[kind];
  if (!mod) return true; // tipos sin módulo mapeado no se bloquean
  return checkPerm(user, mod, "editar");
}

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
  if (!(await canEditOrgKind(req.user, kind))) return res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción." });
  // superadmin puede crear global (difusión); el resto siempre a su establecimiento.
  const establishmentId = req.user.role === "superadmin"
    ? (global ? null : (req.body.establishmentId || null))
    : (req.user.establishmentId || null);
  const r = await prisma.orgRecord.create({ data: { establishmentId, kind, data: data || {} } });
  res.status(201).json(r);
});

// Verifica que el registro sea del establecimiento del usuario (o global, o súper admin).
function ownsOrg(user, establishmentId) {
  return user.role === "superadmin" || establishmentId === null || establishmentId === (user.establishmentId || "");
}

// Actualizar (merge de data)
orgRouter.patch("/records/:id", auth, async (req, res) => {
  const cur = await prisma.orgRecord.findUnique({ where: { id: req.params.id } });
  if (!cur) return res.status(404).json({ error: "Registro no encontrado." });
  if (!ownsOrg(req.user, cur.establishmentId)) return res.status(403).json({ error: "Sin acceso a este registro." });
  if (!(await canEditOrgKind(req.user, cur.kind))) return res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción." });
  const r = await prisma.orgRecord.update({ where: { id: req.params.id }, data: { data: { ...cur.data, ...(req.body.data || {}) } } });
  res.json(r);
});

// Eliminar
orgRouter.delete("/records/:id", auth, async (req, res) => {
  const cur = await prisma.orgRecord.findUnique({ where: { id: req.params.id } });
  if (!cur) return res.status(404).json({ error: "Registro no encontrado." });
  if (!ownsOrg(req.user, cur.establishmentId)) return res.status(403).json({ error: "Sin acceso a este registro." });
  if (!(await canEditOrgKind(req.user, cur.kind))) return res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción." });
  await prisma.orgRecord.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
