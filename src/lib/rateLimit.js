// Protección anti fuerza bruta (en memoria; una instancia).
// Bloqueo temporal tras demasiados intentos fallidos por IP+RUT y por IP.
const buckets = new Map(); // key -> { fails, first, blockedUntil }
const WINDOW = 15 * 60 * 1000; // ventana de conteo
const BLOCK = 15 * 60 * 1000;  // duración del bloqueo

// Segundos restantes de bloqueo (0 si no está bloqueado).
export function blockedFor(key) {
  const b = buckets.get(key);
  if (b && b.blockedUntil > Date.now()) return Math.ceil((b.blockedUntil - Date.now()) / 1000);
  return 0;
}

// Registra un fallo; bloquea al superar `max` en la ventana.
export function recordFail(key, max) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.first > WINDOW) b = { fails: 0, first: now, blockedUntil: 0 };
  b.fails += 1;
  if (b.fails >= max) b.blockedUntil = now + BLOCK;
  buckets.set(key, b);
}

export function recordSuccess(key) { buckets.delete(key); }

export function clientIp(req) {
  // Con app.set("trust proxy", 1), req.ip es la IP real del cliente (no falsificable con X-Forwarded-For extra).
  return String(req.ip || req.socket?.remoteAddress || "unknown").trim();
}

// Limpieza periódica de entradas viejas.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.blockedUntil < now && now - b.first > WINDOW) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref?.();
