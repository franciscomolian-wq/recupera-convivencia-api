import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Idempotente: si ya existe el admin demo, no volver a sembrar.
  const yaExiste = await prisma.user.findUnique({ where: { email: "admin@recupera.cl" } });
  if (yaExiste) {
    console.log("Seed omitido: los datos demo ya existen.");
    return;
  }

  // Establecimiento demo
  const e1 = await prisma.establishment.create({
    data: { name: "Liceo Ejemplo", comuna: "Quilpué", type: "media", sostenedor: "Corp. Municipal Quilpué", students: 820, ufPerStudent: 0.05, paidUF: 41, cumplimiento: 82 },
  });

  // Súper admin + coordinadora demo
  const pass = await bcrypt.hash("demo1234", 10);
  await prisma.user.createMany({
    data: [
      { name: "Administración Central", email: "admin@recupera.cl", passwordHash: pass, role: "superadmin" },
      { name: "Camila Coordinadora", email: "coordinacion@recupera.cl", passwordHash: pass, role: "coordinador", establishmentId: e1.id },
    ],
  });

  // Estudiante con expediente + un caso
  const s1 = await prisma.student.create({
    data: {
      name: "Estudiante J. M.", curso: "7°B", nivel: "basica", establishmentId: e1.id,
      apoderadoNombre: "María (apoderada de J.M.)", apoderadoEmail: "apoderado.jm@correo.cl",
      entrevistas: { create: [{ fecha: "2026-06-30", con: "Apoderado/a", resumen: "Se informa la situación y se acuerdan medidas." }] },
      compromisos: { create: [{ texto: "Asistir a talleres de habilidades sociales", cumplido: false }] },
      medidas: { create: [{ tipo: "formativa", descripcion: "Mediación entre pares", fecha: "2026-07-06" }] },
    },
  });

  await prisma.case.create({
    data: {
      code: "RC-2026-014", typeKey: "bullying", studentLabel: "Estudiante 7°B (iniciales J.M.)",
      level: "basica", curso: "7°B", studentId: s1.id, establishmentId: e1.id, currentStepIdx: 2,
      steps: { create: [
        { order: 0, title: "Acogida y registro confidencial de la denuncia", role: "Coordinador de Convivencia", basis: "Ley 21.809", done: true },
        { order: 1, title: "Evaluación de riesgo y medidas de resguardo", role: "Coordinador de Convivencia", basis: "Ley 21.809", done: true },
        { order: 2, title: "Entrevistas a involucrados", role: "Equipo de Convivencia", basis: "Ley 21.809", done: false },
      ] },
    },
  });

  console.log("Seed listo. Usuarios demo (password: demo1234): admin@recupera.cl / coordinacion@recupera.cl");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
