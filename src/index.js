import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { prisma } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { establishmentsRouter } from "./routes/establishments.js";
import { casesRouter } from "./routes/cases.js";
import { studentsRouter } from "./routes/students.js";
import { usersRouter } from "./routes/users.js";
import { orgRouter } from "./routes/org.js";
import { auditRouter } from "./routes/audit.js";
import { adminRouter } from "./routes/admin.js";

const app = express();

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

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API escuchando en puerto ${PORT}`));
