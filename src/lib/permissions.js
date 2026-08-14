// Permisos por rol × módulo, aplicados en el servidor.
// Refleja la lógica del frontend: defaults por scope + overrides por establecimiento (permset).
import { prisma } from "../db.js";

const ROLE_SCOPE = {
  superadmin: "superadmin", coordinador: "admin", inspectoria: "admin",
  director: "audit", sostenedor: "audit", superintendencia: "audit",
  pie: "limited", orientacion: "limited", utp: "limited",
  profesorJefe: "limited", docente: "limited", asistente: "limited",
  apoderado: "family",
};
const AUDIT_KEYS = new Set(["alertas", "casos", "expedientes", "inspectoria", "pie", "agenda", "apoderados", "documental", "reportes", "planpme", "gestion", "normativa", "redes"]);
const LIMITED_KEYS = new Set(["casos", "expedientes", "pie", "agenda", "comunicacion", "apoderados", "documental", "planpme", "formatos", "normativa"]);
const RANK = { "": 0, ver: 1, editar: 2 };

export function defaultLevel(roleKey, mk) {
  const sc = ROLE_SCOPE[roleKey];
  if (sc === "admin" || sc === "superadmin") return "editar";
  if (sc === "audit") return AUDIT_KEYS.has(mk) ? "ver" : "";
  if (sc === "limited") return LIMITED_KEYS.has(mk) ? "editar" : "";
  return "";
}

export function effLevel(roleKey, mk, permsetData) {
  const custom = permsetData && permsetData[roleKey];
  if (custom && Object.prototype.hasOwnProperty.call(custom, mk)) return custom[mk];
  return defaultLevel(roleKey, mk);
}

// Carga el permset (matriz de permisos) del establecimiento, si existe.
export async function loadPermset(establishmentId) {
  if (!establishmentId) return null;
  const rec = await prisma.orgRecord.findFirst({ where: { kind: "permset", establishmentId } });
  return rec?.data || null;
}

// ¿El usuario tiene al menos `minLevel` en `moduleKey`?
export async function checkPerm(user, moduleKey, minLevel = "editar") {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  const permset = await loadPermset(user.establishmentId);
  return RANK[effLevel(user.role, moduleKey, permset)] >= RANK[minLevel];
}

// Middleware estático: exige `minLevel` en `moduleKey`.
export function requirePerm(moduleKey, minLevel = "editar") {
  return async (req, res, next) => {
    if (await checkPerm(req.user, moduleKey, minLevel)) return next();
    res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción." });
  };
}

// Mapeo de tipos de registro a su módulo (para chequeo dinámico).
export const STUDENT_KIND_MODULE = {
  anotacion: "inspectoria", suspension: "inspectoria", atraso: "inspectoria", retiro: "inspectoria",
  pieInforme: "pie", pieAdecuacion: "pie", pieEstrategia: "pie", pieReunion: "pie",
  citacionApo: "apoderados", acuerdoApo: "apoderados", docApo: "apoderados",
};
export const ORG_KIND_MODULE = {
  message: "comunicacion", event: "agenda", gestion: "gestion", document: "documental", accion: "planpme", protocol: "protocolos",
};
