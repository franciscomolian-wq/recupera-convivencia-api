// Respaldo diario automático por correo (vía Brevo).
// Genera el JSON completo y lo envía como adjunto a los destinatarios.
// Destinatarios: variable BACKUP_EMAIL (uno o varios separados por coma);
// si no está, todos los usuarios súper admin que tengan correo.
// Se programa desde index.js (una vez al día). El disco del contenedor es
// efímero, por eso el respaldo se envía FUERA del servidor (correo).
import { prisma } from "../db.js";
import { buildBackup } from "./backup.js";
import { sendEmail, mailerConfigured } from "./mailer.js";

async function backupRecipients() {
  const env = (process.env.BACKUP_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  const admins = await prisma.user.findMany({ where: { role: "superadmin", NOT: { email: null } }, select: { email: true } });
  return admins.map((a) => a.email).filter(Boolean);
}

function backupHtml({ date, counts, sizeKb }) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#3C4043">
    <div style="background:#1A73E8;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:600">Recupera Convivencia</div>
      <div style="font-size:12px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Respaldo diario · ${date}</div>
    </div>
    <div style="border:1px solid #DADCE0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p>Adjunto va el <b>respaldo completo</b> de la base de datos al ${date}.</p>
      <table style="font-size:14px;border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Establecimientos</td><td><b>${counts.establishments}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Usuarios</td><td><b>${counts.users}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Estudiantes</td><td><b>${counts.students}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Casos</td><td><b>${counts.cases}</b></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5F6368">Tamaño</td><td><b>${sizeKb} KB</b></td></tr>
      </table>
      <p style="font-size:12px;color:#5F6368">Guarda este correo o su adjunto en un lugar seguro. El adjunto es un archivo JSON (con extensión <b>.json.txt</b> por compatibilidad de correo; para restaurarlo, renómbralo quitando el <b>.txt</b>). El relato de los casos va cifrado; las contraseñas y los secretos 2FA no se incluyen.</p>
    </div>
  </div>`;
}

export async function runDailyBackup() {
  if (!mailerConfigured()) { console.log("[backup] correo no configurado; se omite el respaldo diario"); return { sent: false, reason: "not-configured" }; }
  const to = await backupRecipients();
  if (!to.length) { console.log("[backup] sin destinatarios (define BACKUP_EMAIL o un súper admin con correo)"); return { sent: false, reason: "no-recipient" }; }
  try {
    const { data, counts } = await buildBackup();
    const date = new Date().toISOString().slice(0, 10);
    const json = JSON.stringify(data);
    const base64 = Buffer.from(json, "utf8").toString("base64");
    const sizeKb = Math.round(base64.length / 1024);
    // Brevo rechaza adjuntos .json; se envía como .json.txt (mismo contenido). Renombrar a .json al restaurar.
    const filename = `respaldo-recupera-${date}.json.txt`;
    const r = await sendEmail({
      to,
      subject: `Respaldo diario · Recupera Convivencia · ${date}`,
      html: backupHtml({ date, counts, sizeKb }),
      attachments: [{ content: base64, name: filename }],
    });
    console.log(`[backup] ${r.sent ? "enviado" : "no enviado (" + r.reason + ")"} a ${to.join(", ")} · ${sizeKb}KB`);
    return { ...r, to, counts, sizeKb };
  } catch (e) {
    console.error("[backup] error", e);
    return { sent: false, reason: "exception" };
  }
}
