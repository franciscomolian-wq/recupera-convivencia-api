import { Router } from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { recommendProtocol, protocolEngineConfigured } from "../lib/protocolEngine.js";
import { audit } from "../lib/audit.js";

export const protocolsRouter = Router();
const canManage = requireRole("superadmin", "coordinador", "director");

// ¿Está disponible la IA?
protocolsRouter.get("/status", auth, (req, res) => {
  res.json({ ai: protocolEngineConfigured() });
});

// Recomendar un protocolo a partir del manual del establecimiento.
// La base legal (nationalSteps) la envía el frontend y se preserva como piso mínimo.
protocolsRouter.post("/recommend", auth, canManage, async (req, res) => {
  const { typeLabel, nationalSteps, manualText } = req.body || {};
  if (!Array.isArray(nationalSteps) || !nationalSteps.length)
    return res.status(400).json({ error: "Faltan los pasos base del protocolo." });
  const out = await recommendProtocol({ typeLabel: typeLabel || "Caso", nationalSteps, manualText });
  audit(req, "protocol.recommend", { detail: `${typeLabel || ""} · ${out.source}` });
  res.json(out);
});
