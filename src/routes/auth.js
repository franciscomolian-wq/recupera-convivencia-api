import { Router } from "express";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { prisma } from "../db.js";
import { signToken, auth } from "../middleware/auth.js";
import { normalizeRut, isValidRut, formatRut } from "../lib/rut.js";

export const authRouter = Router();

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
  const user = await prisma.user.findUnique({ where: { rut: normalizeRut(rut) } });
  if (!user) return res.status(401).json({ error: "Credenciales inválidas." });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Credenciales inválidas." });

  if (user.totpEnabled) {
    if (!token)
      return res.status(401).json({ error: "Ingresa el código de tu aplicación de autenticación.", twofa: true });
    const valid = authenticator.verify({ token: String(token).trim(), secret: user.totpSecret });
    if (!valid)
      return res.status(401).json({ error: "Código de verificación inválido.", twofa: true });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
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
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret, totpEnabled: false } });
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
  const valid = authenticator.verify({ token: String(token || "").trim(), secret: user.totpSecret });
  if (!valid) return res.status(400).json({ error: "Código inválido. Revisa la hora del teléfono e inténtalo de nuevo." });
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
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
  res.json({ ok: true });
});
