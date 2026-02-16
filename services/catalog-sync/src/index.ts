import { PrismaClient } from '@texflow/database';

const prisma = new PrismaClient();

async function runSync() {
  const merchants = await prisma.merchant.findMany({
    where: { catalogSyncEnabled: true },
  });
  for (const m of merchants) {
    console.log(`Sync merchant ${m.id} (${m.businessName}) - placeholder`);
    await prisma.merchant.update({
      where: { id: m.id },
      data: { lastSyncAt: new Date() },
    });
  }
}

async function main() {
  const interval = Number(process.env.SYNC_INTERVAL_MS) || 3600 * 1000;
  await runSync();
  setInterval(runSync, interval);
}

main().catch(console.error);
