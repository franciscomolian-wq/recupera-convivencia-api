import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-cambiar";

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, establishmentId: user.establishmentId, name: user.name, email: user.email || null },
    SECRET,
    { expiresIn: "8h" }
  );
}

// Requiere token válido
export function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Falta el token de autenticación." });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

// Restringe a ciertos roles
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: "No tienes permiso para esta acción." });
    next();
  };
}
