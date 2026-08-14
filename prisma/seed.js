import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_INSTITUTIONS = [
  { id: "opd", label: "OPD / Mejor Niñez", type: "protección" },
  { id: "tribunal", label: "Tribunal de Familia", type: "judicial" },
  { id: "carabineros", label: "Carabineros de Chile", type: "seguridad" },
  { id: "pdi", label: "PDI", type: "seguridad" },
  { id: "fiscalia", label: "Fiscalía (Ministerio Público)", type: "judicial" },
  { id: "super", label: "Superintendencia de Educación", type: "fiscalización" },
  { id: "junji", label: "JUNJI", type: "fiscalización" },
  { id: "senadis", label: "SENADIS", type: "protección" },
  { id: "dt", label: "Dirección del Trabajo", type: "laboral" },
  { id: "salud", label: "Salud / Salud mental", type: "salud" },
  { id: "mutual", label: "Mutual de seguridad", type: "laboral" },
  { id: "psicosocial", label: "Equipo psicosocial interno", type: "interno" },
  { id: "senda", label: "SENDA (prevención de drogas)", type: "salud" },
  { id: "seguroEscolar", label: "Seguro Escolar (Ley 16.744)", type: "salud" },
  { id: "cesfam", label: "CESFAM / Hospital", type: "salud" },
  { id: "oln", label: "Oficina Local de la Niñez (OLN)", type: "protección" },
  { id: "defensoria", label: "Defensoría de la Niñez", type: "protección" },
  { id: "mejorNinez", label: "Servicio Mejor Niñez", type: "protección" },
  { id: "pjud", label: "Poder Judicial", type: "judicial" },
  { id: "slep", label: "Servicio Local de Educación Pública (SLEP)", type: "fiscalización" },
  { id: "municipio", label: "Municipalidad", type: "comunitaria" },
  { id: "comunitaria", label: "Organización comunitaria", type: "comunitaria" },
];

async function main() {
  // Auto-reparación: si los usuarios demo venían de un seed anterior sin RUT, se lo asignamos.
  await prisma.user.updateMany({ where: { email: "admin@recupera.cl" }, data: { rut: "111111111" } });
  await prisma.user.updateMany({ where: { email: "coordinacion@recupera.cl" }, data: { rut: "222222222" } });

  // Instituciones de derivación (siempre presentes; no se duplican).
  for (const inst of DEFAULT_INSTITUTIONS) {
    await prisma.institution.upsert({ where: { id: inst.id }, update: {}, create: { ...inst, email: "" } });
  }

  // Idempotente: si ya existe el admin demo, no volver a sembrar el resto.
  const yaExiste = await prisma.user.findUnique({ where: { email: "admin@recupera.cl" } });
  if (yaExiste) {
    console.log("Seed omitido: los datos demo ya existen (RUT verificado).");
    return;
  }

  // Establecimiento demo
  const e1 = await prisma.establishment.create({
    data: { name: "Liceo Ejemplo", comuna: "Quilpué", type: "media", sostenedor: "Corp. Municipal Quilpué", students: 820, ufPerStudent: 0.05, paidUF: 41, cumplimiento: 82 },
  });

  // Súper admin + coordinadora demo (login por RUT, password demo1234)
  const pass = await bcrypt.hash("demo1234", 10);
  await prisma.user.createMany({
    data: [
      { name: "Administración Central", rut: "111111111", email: "admin@recupera.cl", passwordHash: pass, role: "superadmin" },
      { name: "Camila Coordinadora", rut: "222222222", email: "coordinacion@recupera.cl", passwordHash: pass, role: "coordinador", establishmentId: e1.id },
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
