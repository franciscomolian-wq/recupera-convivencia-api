// Registro de auditoría. audit() es "fire-and-forget": nunca debe romper la petición.
import { prisma } from "../db.js";

export function audit(req, action, { entity, entityId, detail, establishmentId } = {}) {
  try {
    const u = req?.user || {};
    const ip = (req?.headers?.["x-forwarded-for"]?.split(",")[0] || req?.socket?.remoteAddress || "").trim();
    prisma.auditLog.create({
      data: {
        userId: u.id || null,
        userName: u.name || null,
        userRole: u.role || null,
        establishmentId: establishmentId ?? u.establishmentId ?? null,
        action,
        entity: entity || null,
        entityId: entityId || null,
        detail: detail || null,
        ip: ip || null,
      },
    }).catch(() => {});
  } catch {
    /* nunca interrumpir la operación principal por el log */
  }
}
