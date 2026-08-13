// Envío de correos vía Brevo (API HTTP). Gratuito hasta 300 correos/día.
// Config por variables de entorno (Railway):
//   BREVO_API_KEY  — clave API de Brevo (SMTP & API → API Keys)
//   SENDER_EMAIL   — remitente verificado en Brevo (ej: convivencia@tucolegio.cl)
//   SENDER_NAME    — nombre visible del remitente (opcional)
// Si BREVO_API_KEY no está, el envío se omite silenciosamente (se sigue usando el enlace copiable).

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL = process.env.SENDER_EMAIL || "";
const SENDER_NAME = process.env.SENDER_NAME || "Recupera Convivencia";

export function mailerConfigured() {
  return !!(BREVO_API_KEY && SENDER_EMAIL);
}

function inviteHtml({ name, inviteUrl }) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#3C4043">
    <div style="background:#1A73E8;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:600">Recupera Convivencia</div>
      <div style="font-size:12px;opacity:.85;letter-spacing:1px;text-transform:uppercase">Plataforma de convivencia escolar</div>
    </div>
    <div style="border:1px solid #DADCE0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p>Hola${name ? " " + name : ""},</p>
      <p>Se creó una cuenta para ti en <b>Recupera Convivencia</b>. Para activarla y definir tu contraseña, haz clic en el botón:</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${inviteUrl}" style="background:#1A73E8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;display:inline-block">Activar mi cuenta</a>
      </p>
      <p style="font-size:12px;color:#5F6368">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <span style="word-break:break-all;color:#1A73E8">${inviteUrl}</span>
      </p>
      <p style="font-size:12px;color:#5F6368">El enlace es válido por 7 días. Si no esperabas este correo, puedes ignorarlo.</p>
    </div>
  </div>`;
}

// Envía el correo de invitación. Devuelve { sent, reason? }.
export async function sendInviteEmail({ to, name, inviteUrl }) {
  if (!mailerConfigured()) return { sent: false, reason: "not-configured" };
  if (!to) return { sent: false, reason: "no-recipient" };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: SENDER_EMAIL, name: SENDER_NAME },
        to: [{ email: to, name: name || to }],
        subject: "Activa tu cuenta en Recupera Convivencia",
        htmlContent: inviteHtml({ name, inviteUrl }),
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("Brevo error", res.status, err);
      return { sent: false, reason: "send-failed" };
    }
    return { sent: true };
  } catch (e) {
    console.error("Brevo exception", e);
    return { sent: false, reason: "exception" };
  }
}
