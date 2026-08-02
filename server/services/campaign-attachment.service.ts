import { prisma } from '../lib/prisma';
import { uploadFileToR2, deleteFromR2, getPresignedViewUrl, copyObjectInR2, getObjectSize } from '../lib/r2';
import { getCampaignAttachmentKey } from '../lib/whatsapp-campaign-paths';

export class CampaignAttachmentError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Mirrors real WhatsApp Cloud API media limits so validation feels authentic.
const TYPE_RULES = {
  IMAGE: { extensions: ['.jpg', '.jpeg', '.png'], maxBytes: 5 * 1024 * 1024 },
  VIDEO: { extensions: ['.mp4', '.3gp'], maxBytes: 16 * 1024 * 1024 },
  PDF: { extensions: ['.pdf'], maxBytes: 100 * 1024 * 1024 },
  DOCUMENT: { extensions: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'], maxBytes: 100 * 1024 * 1024 },
} satisfies Record<string, { extensions: string[]; maxBytes: number }>;

export const ALL_ALLOWED_EXTENSIONS = new Set(Object.values(TYPE_RULES).flatMap((r) => r.extensions));
export const MAX_UPLOAD_MB = 100;

export const inferAttachmentType = (ext: string): keyof typeof TYPE_RULES | null => {
  const lower = ext.toLowerCase();
  for (const [type, rule] of Object.entries(TYPE_RULES)) {
    if (rule.extensions.includes(lower)) return type as keyof typeof TYPE_RULES;
  }
  return null;
};

export const getMaxBytesForType = (type: string): number => TYPE_RULES[type]?.maxBytes ?? 0;

const findOwnedCampaignWithAttachment = async (campaignId: string, userId: string) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { attachment: true } });
  if (!campaign || campaign.userId !== userId) throw new CampaignAttachmentError('Campaign not found', 404);
  return campaign;
};

export interface UploadedAttachmentInfo {
  localPath: string;
  originalFilename: string;
  ext: string;
  mimeType: string;
  fileSizeBytes: number;
}

export const toPublicAttachment = async (attachment: {
  id: string;
  type: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: bigint;
  storageKey: string;
}) => ({
  id: attachment.id,
  type: attachment.type,
  originalFilename: attachment.originalFilename,
  mimeType: attachment.mimeType,
  fileSizeBytes: attachment.fileSizeBytes.toString(),
  previewUrl: await getPresignedViewUrl(attachment.storageKey),
});

export const setAttachment = async (userId: string, campaignId: string, info: UploadedAttachmentInfo) => {
  const campaign = await findOwnedCampaignWithAttachment(campaignId, userId);

  const type = inferAttachmentType(info.ext);
  if (!type) throw new CampaignAttachmentError(`Unsupported attachment type: ${info.ext}`, 400);
  const maxBytes = getMaxBytesForType(type);
  if (info.fileSizeBytes > maxBytes) {
    throw new CampaignAttachmentError(
      `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit for ${type.toLowerCase()} attachments`,
      413,
    );
  }

  const storageKey = getCampaignAttachmentKey(campaignId, `attachment${info.ext}`);
  await uploadFileToR2(info.localPath, storageKey);

  if (campaign.attachment && campaign.attachment.storageKey !== storageKey) {
    await deleteFromR2([campaign.attachment.storageKey]);
  }

  const attachment = await prisma.campaignAttachment.upsert({
    where: { campaignId },
    create: {
      campaignId,
      type,
      originalFilename: info.originalFilename.slice(0, 255),
      mimeType: info.mimeType,
      fileSizeBytes: BigInt(info.fileSizeBytes),
      storageKey,
    },
    update: {
      type,
      originalFilename: info.originalFilename.slice(0, 255),
      mimeType: info.mimeType,
      fileSizeBytes: BigInt(info.fileSizeBytes),
      storageKey,
    },
  });

  return toPublicAttachment(attachment);
};

export const removeAttachment = async (userId: string, campaignId: string) => {
  const campaign = await findOwnedCampaignWithAttachment(campaignId, userId);
  if (!campaign.attachment) throw new CampaignAttachmentError('No attachment to remove', 404);
  await deleteFromR2([campaign.attachment.storageKey]);
  await prisma.campaignAttachment.delete({ where: { campaignId } });
};

// Campaign Defaults (Phase 5): copies the account's default attachment into
// a brand-new campaign's own attachment slot, reusing the exact same R2 copy
// helper Duplicate Campaign already relies on - never re-implemented.
export const applyDefaultAttachment = async (userId: string, campaignId: string) => {
  const campaign = await findOwnedCampaignWithAttachment(campaignId, userId);
  if (campaign.attachment) return null; // don't clobber an attachment the user already set

  const account = await prisma.whatsappAccount.findUnique({ where: { userId } });
  if (!account?.defaultAttachmentKey || !account.defaultAttachmentType || !account.defaultAttachmentFilename || !account.defaultAttachmentMimeType) {
    return null;
  }

  const ext = account.defaultAttachmentKey.slice(account.defaultAttachmentKey.lastIndexOf('.'));
  const destKey = getCampaignAttachmentKey(campaignId, `attachment${ext}`);
  await copyObjectInR2(account.defaultAttachmentKey, destKey);
  const sizeBytes = await getObjectSize(destKey).catch(() => 0);

  const attachment = await prisma.campaignAttachment.create({
    data: {
      campaignId,
      type: account.defaultAttachmentType as any,
      originalFilename: account.defaultAttachmentFilename,
      mimeType: account.defaultAttachmentMimeType,
      fileSizeBytes: BigInt(sizeBytes),
      storageKey: destKey,
    },
  });
  return toPublicAttachment(attachment);
};
