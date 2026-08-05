import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
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

  console.log("Seed listo. Usuarios demo (password: demo1234): admin@recupera.cl / coordinacion@recupera.cl");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
