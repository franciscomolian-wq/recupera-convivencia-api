import { Router } from "express";
import { prisma } from "../db.js";
import { auth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { encryptionConfigured } from "../lib/crypto.js";
import { mailerConfigured, brevoApi } from "../lib/mailer.js";
import { runDeadlineReminders } from "../lib/reminders.js";
import { buildBackup } from "../lib/backup.js";
import { runDailyBackup } from "../lib/dailyBackup.js";

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
  const { data, counts } = await buildBackup();
  audit(req, "admin.backup", { detail: `users:${counts.users} cases:${counts.cases} students:${counts.students}` });
  res.setHeader("Content-Disposition", `attachment; filename="respaldo-recupera-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

// --- Gestión del dominio de envío en Brevo (para configurar el correo con dominio propio) ---
// Lista los dominios de envío y su estado (verified/authenticated/dkim).
adminRouter.get("/brevo/domains", auth, superadmin, async (req, res) => {
  const r = await brevoApi("GET", "/senders/domains");
  res.status(r.status || 502).json(r.data);
});
// Dispara la validación/autenticación (DKIM) de un dominio en Brevo.
adminRouter.post("/brevo/authenticate", auth, superadmin, async (req, res) => {
  const domain = req.body?.domain;
  if (!domain) return res.status(400).json({ error: "Falta 'domain'." });
  const r = await brevoApi("PUT", `/senders/domains/${encodeURIComponent(domain)}/authenticate`, {});
  res.status(r.status || 502).json(r.data);
});
// Registra el dominio en Brevo si no existe (devuelve los registros DNS que pide).
adminRouter.post("/brevo/domains", auth, superadmin, async (req, res) => {
  const domain = req.body?.domain;
  if (!domain) return res.status(400).json({ error: "Falta 'domain'." });
  const r = await brevoApi("POST", "/senders/domains", { name: domain });
  res.status(r.status || 502).json(r.data);
});

// Lista los modelos disponibles en Groq (para elegir/actualizar el modelo del motor de protocolos).
adminRouter.get("/groq/models", auth, superadmin, async (req, res) => {
  const key = process.env.GROQ_API_KEY || "";
  if (!key) return res.status(400).json({ error: "GROQ_API_KEY no configurada" });
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + key } });
    const data = await r.json().catch(() => ({}));
    res.status(r.status).json(data);
  } catch (e) { res.status(502).json({ error: String(e?.message || e) }); }
});

// Disparar manualmente el respaldo diario por correo (para pruebas/operación).
adminRouter.post("/run-backup", auth, superadmin, async (req, res) => {
  const r = await runDailyBackup();
  audit(req, "admin.backup.email", { detail: r.sent ? `enviado a ${(r.to || []).join(", ")}` : `no enviado: ${r.reason}` });
  res.json(r);
});
