import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { prisma } from "./db.js";

// Seguridad: en producción, abortar si faltan los secretos (evita JWT falsificables o datos en claro).
const isProd = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
for (const key of ["JWT_SECRET", "ENCRYPTION_KEY"]) {
  if (!process.env[key]) {
    if (isProd) { console.error(`[FATAL] Falta ${key}. Abortando por seguridad.`); process.exit(1); }
    else console.warn(`[ADVERTENCIA] Falta ${key} (solo aceptable en desarrollo).`);
  }
}
import { authRouter } from "./routes/auth.js";
import { establishmentsRouter } from "./routes/establishments.js";
import { casesRouter } from "./routes/cases.js";
import { studentsRouter } from "./routes/students.js";
import { usersRouter } from "./routes/users.js";
import { orgRouter } from "./routes/org.js";
import { auditRouter } from "./routes/audit.js";
import { adminRouter } from "./routes/admin.js";
import { protocolsRouter } from "./routes/protocols.js";
import { institutionsRouter } from "./routes/institutions.js";

const app = express();
// Detrás del proxy de Railway: confía en 1 salto para derivar la IP real (anti-spoofing del rate limit).
app.set("trust proxy", 1);
// Cabeceras de seguridad HTTP (HSTS, no-sniff, anti-clickjacking, etc.).
app.use(helmet());

// CORS: permite el frontend de Netlify (configurable por env)
const origins = (process.env.CORS_ORIGIN || "http://localhost:5174,https://recupera-convivencia.netlify.app")
  .split(",").map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Salud (Railway la usa para healthcheck)
app.get("/", (req, res) => res.json({ ok: true, service: "recupera-convivencia-api" }));
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", db: "error", time: new Date().toISOString() });
  }
});

// Rutas
app.use("/api/auth", authRouter);
app.use("/api/establishments", establishmentsRouter);
app.use("/api/cases", casesRouter);
app.use("/api/students", studentsRouter);
app.use("/api/users", usersRouter);
app.use("/api/org", orgRouter);
app.use("/api/audit", auditRouter);
app.use("/api/admin", adminRouter);
app.use("/api/protocols", protocolsRouter);
app.use("/api/institutions", institutionsRouter);

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API escuchando en puerto ${PORT}`));

// Recordatorios de plazos: una vez ~1 min tras arrancar y luego cada 24 h.
import { runDeadlineReminders } from "./lib/reminders.js";
setTimeout(() => runDeadlineReminders().then((n) => n && console.log(`Recordatorios enviados: ${n}`)).catch((e) => console.error("reminders", e)), 60 * 1000);
setInterval(() => runDeadlineReminders().catch((e) => console.error("reminders", e)), 24 * 60 * 60 * 1000);

// Respaldo diario por correo: se programa a una hora fija (por defecto 07:00 UTC ≈ 03:00 Chile)
// y luego cada 24 h. No corre en cada arranque para no enviar un correo por redeploy.
import { runDailyBackup } from "./lib/dailyBackup.js";
const BACKUP_HOUR_UTC = Number(process.env.BACKUP_HOUR_UTC ?? 7);
function msUntilNextUtcHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}
setTimeout(() => {
  runDailyBackup().catch((e) => console.error("backup", e));
  setInterval(() => runDailyBackup().catch((e) => console.error("backup", e)), 24 * 60 * 60 * 1000);
}, msUntilNextUtcHour(BACKUP_HOUR_UTC));
console.log(`[backup] respaldo diario programado para las ${String(BACKUP_HOUR_UTC).padStart(2, "0")}:00 UTC`);
