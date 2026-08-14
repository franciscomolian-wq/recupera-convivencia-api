// Recordatorios de plazos legales por correo.
// Revisa los casos abiertos y avisa cuando el paso actual está por vencer o vencido.
import { prisma } from "../db.js";
import { sendEmail } from "./mailer.js";

const APP_URL = process.env.APP_URL || "https://recupera-convivencia.netlify.app";
const SOON_DAYS = 2; // avisa cuando faltan 2 días o menos

function fmt(d) {
  try { return new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" }); }
  catch { return "—"; }
}

function reminderHtml({ caso, step, overdue }) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#3C4043">
    <div style="background:${overdue ? "#D93025" : "#EA8600"};color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:600">Recupera Convivencia</div>
      <div style="font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:1px">${overdue ? "Plazo vencido" : "Plazo por vencer"}</div>
    </div>
    <div style="border:1px solid #DADCE0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p>Caso <b>${caso.code}</b> — ${caso.studentLabel || ""}</p>
      <p>Etapa actual: <b>${step.title}</b>${step.role ? ` (responsable: ${step.role})` : ""}.</p>
      <p style="font-size:15px;color:${overdue ? "#D93025" : "#EA8600"};font-weight:600">
        ${overdue ? "El plazo venció el" : "El plazo vence el"} ${fmt(step.due)}.
      </p>
      <p style="text-align:center;margin:24px 0">
        <a href="${APP_URL}" style="background:#1A73E8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;display:inline-block">Abrir la plataforma</a>
      </p>
      <p style="font-size:12px;color:#5F6368">Este es un aviso automático del seguimiento de plazos normativos.</p>
    </div>
  </div>`;
}

export async function runDeadlineReminders() {
  const soon = new Date(Date.now() + SOON_DAYS * 24 * 60 * 60 * 1000);
  const cases = await prisma.case.findMany({ where: { closed: false }, include: { steps: { orderBy: { order: "asc" } } } });
  let sent = 0;
  for (const caso of cases) {
    const step = caso.steps.find((s) => s.order === caso.currentStepIdx);
    if (!step || !step.due || step.done || step.reminderSent) continue;
    if (new Date(step.due) > soon) continue; // todavía no está próximo
    const overdue = new Date(step.due) < new Date();
    try {
      const recips = await prisma.user.findMany({
        where: { establishmentId: caso.establishmentId, role: { in: ["coordinador", "director"] }, email: { not: null }, passwordHash: { not: null } },
      });
      const to = recips.map((u) => u.email).filter(Boolean);
      if (to.length) {
        await sendEmail({
          to,
          subject: `${overdue ? "Plazo vencido" : "Plazo por vencer"} — caso ${caso.code}`,
          html: reminderHtml({ caso, step, overdue }),
        });
      }
      await prisma.step.update({ where: { id: step.id }, data: { reminderSent: true } });
      sent += 1;
    } catch (e) { console.error("reminder case", caso.code, e); }
  }
  return sent;
}
