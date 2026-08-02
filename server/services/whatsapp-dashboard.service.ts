import { prisma } from '../lib/prisma';
import { toPublicAccount } from './whatsapp-account.service';

export const getDashboard = async (userId: string) => {
  const [account, contactCount, groupCount, labelCount, recentImports] = await Promise.all([
    prisma.whatsappAccount.findUnique({ where: { userId } }),
    prisma.contact.count({ where: { userId } }),
    prisma.group.count({ where: { userId } }),
    prisma.label.count({ where: { userId } }),
    prisma.contactImportBatch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  return {
    account: account ? toPublicAccount(account) : null,
    totalContacts: contactCount,
    totalGroups: groupCount,
    totalLabels: labelCount,
    recentImports,
  };
};
