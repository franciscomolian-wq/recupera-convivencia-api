// Cifrado en reposo de datos sensibles (Ley 21.719).
// AES-256-GCM con clave desde ENCRYPTION_KEY (32 bytes en base64 o hex).
// Si no hay clave configurada, se guarda en claro (degradación segura para dev),
// pero en producción SIEMPRE debe existir ENCRYPTION_KEY.
import crypto from "crypto";

const PREFIX = "enc:v1:"; // marca para distinguir texto cifrado de texto en claro (migración segura)

function getKey() {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw) return null;
  // Acepta base64 o hex; debe dar 32 bytes.
  let buf;
  try {
    buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  return buf.length === 32 ? buf : null;
}

export function encryptionConfigured() {
  return !!getKey();
}

// Cifra un texto. Devuelve "enc:v1:<iv>:<tag>:<ciphertext>" (todo base64) o el texto original si no hay clave.
export function encrypt(plain) {
  if (plain == null) return plain;
  const key = getKey();
  if (!key) return plain; // sin clave: se guarda en claro (dev)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

// Descifra. Si el valor no está cifrado (sin prefijo), lo devuelve tal cual (compatibilidad).
export function decrypt(value) {
  if (value == null || typeof value !== "string" || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) return value;
  try {
    const [, , ivB64, tagB64, ctB64] = value.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return value; // si algo falla, no romper la app
  }
}
