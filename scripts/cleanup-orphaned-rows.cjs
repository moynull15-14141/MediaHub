// One-off maintenance script (not part of the app's normal runtime) for
// recovering a production database where legacy business rows reference a
// userId that no longer exists in the User table - this blocks the Phase
// A.2 workspace-foundation migration's NOT NULL backfill on workspaceId,
// since a row with no matching user can never resolve to a workspace.
// Safe to run any number of times (only ever deletes rows with no matching
// user; does nothing once none remain). Uses the same DATABASE_URL already
// configured for the service - no separate connection info needed.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TABLES = [
  'AccountAuditLog', 'BlacklistedNumber', 'Campaign', 'Contact', 'ContactImportBatch',
  'Group', 'Label', 'MessageTemplate', 'ReportHistory', 'ScheduledReport', 'WhatsappAccount',
];

(async () => {
  console.log('=== Orphaned-row cleanup starting ===');
  let totalDeleted = 0;
  for (const table of TABLES) {
    const before = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM "${table}" t LEFT JOIN "User" u ON u.id = t."userId" WHERE u.id IS NULL`
    );
    const orphanCount = before[0].count;
    if (orphanCount === 0) {
      console.log(`${table}: 0 orphaned rows, skipping`);
      continue;
    }
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" t USING (SELECT t2.id FROM "${table}" t2 LEFT JOIN "User" u ON u.id = t2."userId" WHERE u.id IS NULL) orphans WHERE t.id = orphans.id`
    );
    console.log(`${table}: deleted ${deleted} orphaned row(s)`);
    totalDeleted += deleted;
  }
  console.log(`=== Done. Total deleted: ${totalDeleted} ===`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('CLEANUP FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
