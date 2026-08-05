import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { signToken, auth } from "../middleware/auth.js";

export const authRouter = Router();

// Registro (en producción, restringir a superadmin/coordinador)
authRouter.post("/register", async (req, res) => {
  const { name, email, password, role, establishmentId } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: "Nombre, email y contraseña son obligatorios." });
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "Ese email ya está registrado." });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: role || "docente", establishmentId: establishmentId || null },
  });
  res.status(201).json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role, establishmentId: user.establishmentId } });
});

// Login
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Credenciales inválidas." });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Credenciales inválidas." });
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role, establishmentId: user.establishmentId } });
});

// Perfil del usuario autenticado
authRouter.get("/me", auth, (req, res) => {
  res.json({ user: req.user });
});
