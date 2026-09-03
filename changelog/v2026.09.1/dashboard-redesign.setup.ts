import { prisma } from "../../apps/api/src/db.ts";
import { ensureDashboardDataset } from "./dashboard-dataset.ts";

await ensureDashboardDataset();
await prisma.$disconnect();
