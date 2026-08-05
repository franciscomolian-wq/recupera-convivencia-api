import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { authRouter } from "./routes/auth.js";
import { establishmentsRouter } from "./routes/establishments.js";
import { casesRouter } from "./routes/cases.js";

const app = express();

// CORS: permite el frontend de Netlify (configurable por env)
const origins = (process.env.CORS_ORIGIN || "http://localhost:5174,https://recupera-convivencia.netlify.app")
  .split(",").map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Salud (Railway la usa para healthcheck)
app.get("/", (req, res) => res.json({ ok: true, service: "recupera-convivencia-api" }));
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Rutas
app.use("/api/auth", authRouter);
app.use("/api/establishments", establishmentsRouter);
app.use("/api/cases", casesRouter);

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API escuchando en puerto ${PORT}`));
