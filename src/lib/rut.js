// Utilidades de RUT chileno: normalización, validación (módulo 11) y formato.

// Deja el RUT en forma canónica para guardar/buscar: sin puntos ni guion, K mayúscula.
// Ej: "12.345.678-5" -> "123456785"
export function normalizeRut(input) {
  if (!input) return "";
  return String(input).replace(/[.\-\s]/g, "").toUpperCase();
}

// Calcula el dígito verificador de un cuerpo numérico (string de solo dígitos).
function dv(body) {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return "0";
  if (res === 10) return "K";
  return String(res);
}

// Valida un RUT completo (con o sin formato).
export function isValidRut(input) {
  const rut = normalizeRut(input);
  if (rut.length < 2) return false;
  const body = rut.slice(0, -1);
  const check = rut.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  return dv(body) === check;
}

// Formatea para mostrar: "123456785" -> "12.345.678-5"
export function formatRut(input) {
  const rut = normalizeRut(input);
  if (rut.length < 2) return rut;
  const body = rut.slice(0, -1);
  const check = rut.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${check}`;
}
