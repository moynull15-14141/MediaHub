import os from 'os';
import path from 'path';

const CAMPAIGN_ATTACHMENT_BASE_DIR = path.join(os.tmpdir(), 'mediahub-whatsapp-campaign-attachments');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidCampaignId = (id: string): boolean => UUID_PATTERN.test(id);

export const getCampaignAttachmentDir = (campaignId: string) => path.join(CAMPAIGN_ATTACHMENT_BASE_DIR, campaignId);

export const getCampaignAttachmentPath = (campaignId: string, filename: string) =>
  path.join(getCampaignAttachmentDir(campaignId), filename);

export const getCampaignAttachmentKey = (campaignId: string, filename: string) =>
  `whatsapp-campaign-attachments/${campaignId}/${filename}`;
