import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { encryptionConfigured } from "../lib/crypto.js";
import { mailerConfigured } from "../lib/mailer.js";
import { runDeadlineReminders } from "../lib/reminders.js";

export const adminRouter = Router();
const superadmin = requireRole("superadmin");

// Disparar manualmente los recordatorios de plazos (para pruebas/operación).
adminRouter.post("/run-reminders", auth, superadmin, async (req, res) => {
  const sent = await runDeadlineReminders();
  audit(req, "reminders.run", { detail: `${sent} enviados` });
  res.json({ sent });
});

// Estado del sistema + métricas (monitoreo). Verifica conectividad de la BD.
adminRouter.get("/status", auth, superadmin, async (req, res) => {
  let db = "ok";
  const counts = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    counts.establishments = await prisma.establishment.count();
    counts.users = await prisma.user.count();
    counts.students = await prisma.student.count();
    counts.cases = await prisma.case.count();
    counts.auditLogs = await prisma.auditLog.count();
  } catch (e) {
    db = "error";
  }
  res.json({
    db,
    counts,
    security: { encryption: encryptionConfigured(), email: mailerConfigured() },
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

// Respaldo lógico completo (JSON) de todos los datos. Solo súper admin.
// El relato de los casos se exporta cifrado (requiere ENCRYPTION_KEY para restaurar).
adminRouter.get("/backup", auth, superadmin, async (req, res) => {
  const [establishments, users, students, cases, steps, evidence, derivations, emailLogs,
    entrevistas, citaciones, compromisos, medidas, studentRecords, orgRecords, payments, auditLogs] = await Promise.all([
    prisma.establishment.findMany(), prisma.user.findMany(), prisma.student.findMany(), prisma.case.findMany(),
    prisma.step.findMany(), prisma.evidence.findMany(), prisma.derivation.findMany(), prisma.emailLog.findMany(),
    prisma.entrevista.findMany(), prisma.citacion.findMany(), prisma.compromiso.findMany(), prisma.medida.findMany(),
    prisma.studentRecord.findMany(), prisma.orgRecord.findMany(), prisma.payment.findMany(), prisma.auditLog.findMany(),
  ]);
  // No exportamos hashes de contraseña, secretos 2FA ni tokens activos.
  const safeUsers = users.map(({ passwordHash, totpSecret, inviteToken, resetToken, ...u }) => u);
  audit(req, "admin.backup", { detail: `users:${users.length} cases:${cases.length} students:${students.length}` });
  res.setHeader("Content-Disposition", `attachment; filename="respaldo-recupera-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    _meta: { generatedAt: new Date().toISOString(), version: 1, note: "Respaldo lógico. El relato de casos va cifrado; contraseñas y secretos 2FA no se exportan." },
    establishments, users: safeUsers, students, cases, steps, evidence, derivations, emailLogs,
    entrevistas, citaciones, compromisos, medidas, studentRecords, orgRecords, payments, auditLogs,
  });
});
