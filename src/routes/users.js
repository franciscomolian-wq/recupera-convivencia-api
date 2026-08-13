import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { normalizeRut, isValidRut, formatRut } from "../lib/rut.js";
import { sendInviteEmail, mailerConfigured } from "../lib/mailer.js";
import { audit } from "../lib/audit.js";

export const usersRouter = Router();

const APP_URL = process.env.APP_URL || "https://recupera-convivencia.netlify.app";
const canManage = requireRole("superadmin", "coordinador", "director");

function scope(user) {
  return user.role === "superadmin" ? {} : { establishmentId: user.establishmentId || "" };
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, rut: u.rut ? formatRut(u.rut) : null, email: u.email || null,
    role: u.role, establishmentId: u.establishmentId,
    activated: !!u.passwordHash, totpEnabled: !!u.totpEnabled,
    pendingInvite: !!u.inviteToken,
  };
}

// Listar usuarios del establecimiento (o todos, si súper admin)
usersRouter.get("/", auth, canManage, async (req, res) => {
  const users = await prisma.user.findMany({ where: scope(req.user), orderBy: { name: "asc" } });
  res.json(users.map(publicUser));
});

// Invitar a un usuario: crea la cuenta y genera el enlace de activación
usersRouter.post("/invite", auth, canManage, async (req, res) => {
  const { name, rut, role, email } = req.body || {};
  if (!name || !rut || !role) return res.status(400).json({ error: "Nombre, RUT y rol son obligatorios." });
  if (!isValidRut(rut)) return res.status(400).json({ error: "El RUT ingresado no es válido." });
  const nrut = normalizeRut(rut);
  const exists = await prisma.user.findUnique({ where: { rut: nrut } });
  if (exists) return res.status(409).json({ error: "Ese RUT ya está registrado." });

  // Un coordinador/director solo puede invitar a su propio establecimiento.
  const establishmentId = req.user.role === "superadmin"
    ? (req.body.establishmentId || null)
    : (req.user.establishmentId || null);

  const inviteToken = crypto.randomBytes(24).toString("hex");
  const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

  const user = await prisma.user.create({
    data: { name, rut: nrut, email: email || null, role, establishmentId, inviteToken, inviteExpires },
  });
  const inviteUrl = `${APP_URL}/?invite=${inviteToken}`;
  const mail = email ? await sendInviteEmail({ to: email, name, inviteUrl }) : { sent: false, reason: "no-email" };
  audit(req, "user.invite", { entity: "user", entityId: user.id, detail: `${name} · ${role}`, establishmentId });
  res.status(201).json({ user: publicUser(user), inviteUrl, expiresAt: inviteExpires, emailSent: mail.sent, mailerConfigured: mailerConfigured() });
});

// Editar un usuario (nombre, correo, rol)
usersRouter.patch("/:id", auth, canManage, async (req, res) => {
  const { name, email, role } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (email !== undefined) data.email = email || null;
  if (role !== undefined) data.role = role;
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    audit(req, "user.edit", { entity: "user", entityId: user.id });
    res.json(publicUser(user));
  } catch {
    res.status(404).json({ error: "Usuario no encontrado." });
  }
});

// Eliminar un usuario (no puedes eliminar tu propia cuenta)
usersRouter.delete("/:id", auth, canManage, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    audit(req, "user.delete", { entity: "user", entityId: req.params.id });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Usuario no encontrado." });
  }
});

// Invitación MASIVA: crea varios usuarios y envía la invitación a cada uno.
// Body: { users: [{ name, rut, role, email }], establishmentId? }
usersRouter.post("/bulk-invite", auth, canManage, async (req, res) => {
  const rows = Array.isArray(req.body?.users) ? req.body.users : [];
  if (!rows.length) return res.status(400).json({ error: "No se recibieron filas para cargar." });
  if (rows.length > 500) return res.status(400).json({ error: "Máximo 500 usuarios por carga." });
  const establishmentId = req.user.role === "superadmin"
    ? (req.body.establishmentId || null)
    : (req.user.establishmentId || null);

  const results = [];
  for (const row of rows) {
    const name = (row?.name || "").trim();
    const rut = (row?.rut || "").trim();
    const role = (row?.role || "").trim();
    const email = (row?.email || "").trim();
    const out = { name, rut, ok: false };
    if (!name || !rut || !role) { out.error = "Faltan datos (nombre, RUT o rol)."; results.push(out); continue; }
    if (!isValidRut(rut)) { out.error = "RUT inválido."; results.push(out); continue; }
    const nrut = normalizeRut(rut);
    const exists = await prisma.user.findUnique({ where: { rut: nrut } });
    if (exists) { out.error = "RUT ya registrado."; results.push(out); continue; }
    try {
      const inviteToken = crypto.randomBytes(24).toString("hex");
      const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const user = await prisma.user.create({ data: { name, rut: nrut, email: email || null, role, establishmentId, inviteToken, inviteExpires } });
      const inviteUrl = `${APP_URL}/?invite=${inviteToken}`;
      const mail = email ? await sendInviteEmail({ to: email, name, inviteUrl }) : { sent: false };
      out.ok = true; out.emailSent = !!mail.sent; out.id = user.id;
    } catch { out.error = "No se pudo crear."; }
    results.push(out);
  }
  const created = results.filter((r) => r.ok).length;
  audit(req, "user.bulk_invite", { detail: `${created}/${rows.length} creados`, establishmentId });
  res.json({ results, created, total: rows.length, emailsSent: results.filter((r) => r.emailSent).length, mailerConfigured: mailerConfigured() });
});

// Regenerar el enlace de invitación de un usuario aún no activado
usersRouter.post("/:id/reinvite", auth, canManage, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  if (user.passwordHash) return res.status(409).json({ error: "La cuenta ya está activada." });
  const inviteToken = crypto.randomBytes(24).toString("hex");
  const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.user.update({ where: { id: user.id }, data: { inviteToken, inviteExpires } });
  const inviteUrl = `${APP_URL}/?invite=${inviteToken}`;
  const mail = user.email ? await sendInviteEmail({ to: user.email, name: user.name, inviteUrl }) : { sent: false, reason: "no-email" };
  res.json({ inviteUrl, expiresAt: inviteExpires, emailSent: mail.sent, mailerConfigured: mailerConfigured() });
});
