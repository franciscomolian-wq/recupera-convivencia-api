import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { prisma } from "../db.js";
import { signToken, auth } from "../middleware/auth.js";
import { normalizeRut, isValidRut, formatRut } from "../lib/rut.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { sendResetEmail } from "../lib/mailer.js";
import { blockedFor, recordFail, recordSuccess, clientIp } from "../lib/rateLimit.js";

export const authRouter = Router();
const APP_URL = process.env.APP_URL || "https://recupera-convivencia.netlify.app";

// Tolerancia de ±1 ventana (30s) por desfase de reloj del celular.
authenticator.options = { window: 1 };
const ISSUER = "Recupera Convivencia";

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    rut: u.rut ? formatRut(u.rut) : null,
    email: u.email || null,
    role: u.role,
    establishmentId: u.establishmentId,
    totpEnabled: !!u.totpEnabled,
  };
}

// Registro (en producción, restringir a superadmin/coordinador)
authRouter.post("/register", async (req, res) => {
  const { name, rut, email, password, role, establishmentId } = req.body || {};
  if (!name || !rut || !password)
    return res.status(400).json({ error: "Nombre, RUT y contraseña son obligatorios." });
  if (!isValidRut(rut))
    return res.status(400).json({ error: "El RUT ingresado no es válido." });
  const nrut = normalizeRut(rut);
  const exists = await prisma.user.findUnique({ where: { rut: nrut } });
  if (exists) return res.status(409).json({ error: "Ese RUT ya está registrado." });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name, rut: nrut, email: email || null, passwordHash,
      role: role || "docente", establishmentId: establishmentId || null,
    },
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// Login por RUT + contraseña (+ código 2FA si está activado)
authRouter.post("/login", async (req, res) => {
  const { rut, password, token } = req.body || {};
  if (!rut || !password)
    return res.status(400).json({ error: "Ingresa tu RUT y tu contraseña." });

  // Anti fuerza bruta: bloqueo temporal por IP y por IP+RUT.
  const ip = clientIp(req);
  const nrut = normalizeRut(rut);
  const ipKey = "ip:" + ip;
  const rutKey = "ir:" + ip + ":" + nrut;
  const wait = Math.max(blockedFor(ipKey), blockedFor(rutKey));
  if (wait > 0) {
    res.set("Retry-After", String(wait));
    return res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60)} minuto(s) e inténtalo de nuevo.` });
  }
  const fail = (msg, extra = {}) => {
    recordFail(ipKey, 30);
    recordFail(rutKey, 6);
    return res.status(401).json({ error: msg, ...extra });
  };

  const user = await prisma.user.findUnique({ where: { rut: nrut } });
  if (!user) return fail("Credenciales inválidas.");
  if (!user.passwordHash) return res.status(401).json({ error: "Esta cuenta aún no está activada. Usa el enlace de invitación que recibiste." });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return fail("Credenciales inválidas.");

  if (user.totpEnabled) {
    if (!token)
      return res.status(401).json({ error: "Ingresa el código de tu aplicación de autenticación.", twofa: true });
    const valid = authenticator.verify({ token: String(token).trim(), secret: decrypt(user.totpSecret) });
    if (!valid) return fail("Código de verificación inválido.", { twofa: true });
  }
  recordSuccess(ipKey); recordSuccess(rutKey);
  audit({ user, headers: req.headers, socket: req.socket }, "login", { entity: "user", entityId: user.id });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// Info pública de un enlace de invitación (para la pantalla de activación)
authRouter.get("/invite/:token", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { inviteToken: req.params.token } });
  if (!user) return res.status(404).json({ error: "El enlace de invitación no es válido." });
  if (user.inviteExpires && user.inviteExpires < new Date())
    return res.status(410).json({ error: "El enlace de invitación expiró. Solicita uno nuevo." });
  res.json({ name: user.name, rut: user.rut ? formatRut(user.rut) : null, role: user.role });
});

// Activar cuenta: la persona define su contraseña con el token del enlace
authRouter.post("/activate", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Faltan datos para activar la cuenta." });
  if (String(password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  const user = await prisma.user.findUnique({ where: { inviteToken: token } });
  if (!user) return res.status(404).json({ error: "El enlace de invitación no es válido." });
  if (user.inviteExpires && user.inviteExpires < new Date())
    return res.status(410).json({ error: "El enlace de invitación expiró. Solicita uno nuevo." });
  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, inviteToken: null, inviteExpires: null },
  });
  audit({ user: updated, headers: req.headers, socket: req.socket }, "user.activate", { entity: "user", entityId: updated.id });
  res.json({ token: signToken(updated), user: publicUser(updated) });
});

// Solicitar recuperación de contraseña (por RUT). No revela si el RUT existe.
authRouter.post("/forgot", async (req, res) => {
  const { rut } = req.body || {};
  const generic = { ok: true, message: "Si el RUT está registrado y tiene correo, te enviamos un enlace de recuperación." };
  if (!rut) return res.json(generic);
  try {
    const user = await prisma.user.findUnique({ where: { rut: normalizeRut(rut) } });
    if (user && user.email && user.passwordHash) {
      const resetToken = crypto.randomBytes(24).toString("hex");
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetExpires } });
      await sendResetEmail({ to: user.email, name: user.name, resetUrl: `${APP_URL}/?reset=${resetToken}` });
      audit({ user, headers: req.headers, socket: req.socket }, "user.forgot_password", { entity: "user", entityId: user.id });
    }
  } catch (e) { console.error("forgot", e); }
  res.json(generic); // siempre igual
});

// Restablecer contraseña con el token del enlace
authRouter.post("/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Faltan datos." });
  if (String(password).length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (!user) return res.status(404).json({ error: "El enlace no es válido." });
  if (user.resetExpires && user.resetExpires < new Date())
    return res.status(410).json({ error: "El enlace expiró. Solicita uno nuevo." });
  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetToken: null, resetExpires: null } });
  audit({ user: updated, headers: req.headers, socket: req.socket }, "user.reset_password", { entity: "user", entityId: updated.id });
  res.json({ token: signToken(updated), user: publicUser(updated) });
});

// Info del enlace de recuperación (para mostrar el nombre)
authRouter.get("/reset/:token", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { resetToken: req.params.token } });
  if (!user) return res.status(404).json({ error: "El enlace no es válido." });
  if (user.resetExpires && user.resetExpires < new Date()) return res.status(410).json({ error: "El enlace expiró." });
  res.json({ name: user.name, rut: user.rut ? formatRut(user.rut) : null });
});

// Perfil del usuario autenticado (fresco desde la BD)
authRouter.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  res.json({ user: publicUser(user) });
});

// --- 2FA (Google Authenticator / TOTP) ---

// Paso 1: generar secreto y QR (queda pendiente hasta confirmar con un código)
authRouter.post("/2fa/setup", auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret), totpEnabled: false } });
  const account = user.rut ? formatRut(user.rut) : (user.email || user.name);
  const otpauth = authenticator.keyuri(account, ISSUER, secret);
  const qr = await QRCode.toDataURL(otpauth);
  res.json({ secret, otpauth, qr });
});

// Paso 2: confirmar el código y activar 2FA
authRouter.post("/2fa/enable", auth, async (req, res) => {
  const { token } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !user.totpSecret)
    return res.status(400).json({ error: "Primero genera el código de vinculación." });
  const valid = authenticator.verify({ token: String(token || "").trim(), secret: decrypt(user.totpSecret) });
  if (!valid) return res.status(400).json({ error: "Código inválido. Revisa la hora del teléfono e inténtalo de nuevo." });
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  audit(req, "user.2fa_enable", { entity: "user", entityId: user.id });
  res.json({ ok: true });
});

// Desactivar 2FA (requiere la contraseña)
authRouter.post("/2fa/disable", auth, async (req, res) => {
  const { password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Contraseña incorrecta." });
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } });
  audit(req, "user.2fa_disable", { entity: "user", entityId: user.id });
  res.json({ ok: true });
});
