// Genera el respaldo lógico completo (JSON) de todos los datos.
// El relato de los casos se exporta cifrado (requiere ENCRYPTION_KEY para restaurar).
// No exporta hashes de contraseña, secretos 2FA ni tokens activos.
import { prisma } from "../db.js";

export async function buildBackup() {
  const [establishments, users, students, cases, steps, evidence, derivations, emailLogs,
    entrevistas, citaciones, compromisos, medidas, studentRecords, orgRecords, payments, auditLogs, caseParticipants] = await Promise.all([
    prisma.establishment.findMany(), prisma.user.findMany(), prisma.student.findMany(), prisma.case.findMany(),
    prisma.step.findMany(), prisma.evidence.findMany(), prisma.derivation.findMany(), prisma.emailLog.findMany(),
    prisma.entrevista.findMany(), prisma.citacion.findMany(), prisma.compromiso.findMany(), prisma.medida.findMany(),
    prisma.studentRecord.findMany(), prisma.orgRecord.findMany(), prisma.payment.findMany(), prisma.auditLog.findMany(),
    prisma.caseParticipant.findMany(),
  ]);
  const safeUsers = users.map(({ passwordHash, totpSecret, inviteToken, resetToken, ...u }) => u);
  const counts = { establishments: establishments.length, users: users.length, students: students.length, cases: cases.length, auditLogs: auditLogs.length };
  const data = {
    _meta: { generatedAt: new Date().toISOString(), version: 2, note: "Respaldo lógico. El relato de casos va cifrado; contraseñas y secretos 2FA no se exportan." },
    establishments, users: safeUsers, students, cases, steps, evidence, derivations, emailLogs,
    entrevistas, citaciones, compromisos, medidas, studentRecords, orgRecords, payments, auditLogs, caseParticipants,
  };
  return { data, counts };
}
