# Recupera Convivencia — API

Backend de la plataforma de convivencia escolar. Node + Express + PostgreSQL (Prisma), autenticación JWT.

## Endpoints principales
- `GET /health` — estado del servicio
- `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me`
- `GET/POST/PATCH /api/establishments`
- `GET/POST /api/cases` · `POST /api/cases/:id/steps/:order/done` · `/derivations` · `/emails`

## Correr en local
1. `npm install`
2. Copiá `.env.example` a `.env` y completá `DATABASE_URL` y `JWT_SECRET`.
3. `npm run db:push` (crea las tablas) y opcional `npm run seed`.
4. `npm run dev` → API en `http://localhost:4000`

## Desplegar en Railway
1. **New Project → Deploy from GitHub repo** → elegí este repo.
2. **+ New → Database → PostgreSQL** (Railway crea la variable `DATABASE_URL`).
3. En el servicio de la API, agregá las variables:
   - `JWT_SECRET` = una cadena larga y aleatoria
   - `CORS_ORIGIN` = `https://recupera-convivencia.netlify.app`
4. En **Settings → Deploy**, comando de arranque: `npm run db:push && npm start`
   (crea/actualiza las tablas y levanta el servidor).
5. Railway te da una URL pública (ej. `https://recupera-convivencia-api.up.railway.app`).

> Nota: nunca subas el archivo `.env` (está en `.gitignore`). Los secretos van en las variables de Railway.
