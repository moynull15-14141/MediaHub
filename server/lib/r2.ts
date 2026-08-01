import fs from 'fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.R2_BUCKET_NAME || '';

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

export const uploadFileToR2 = async (localPath: string, key: string): Promise<void> => {
  const body = fs.createReadStream(localPath);
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
};

export const downloadFileFromR2 = async (key: string, localPath: string): Promise<void> => {
  const result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = result.Body as NodeJS.ReadableStream;
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(localPath);
    body.pipe(writeStream);
    body.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });
};

export const deleteFromR2 = async (keys: string[]): Promise<void> => {
  const validKeys = keys.filter(Boolean);
  if (validKeys.length === 0) return;
  await client
    .send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: validKeys.map((Key) => ({ Key })) },
      }),
    )
    .catch(() => {});
};

export const getPresignedDownloadUrl = async (
  key: string,
  filename: string,
  expiresInSeconds = 3600,
): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
};

// Unlike getPresignedDownloadUrl, this doesn't force a download - used for
// thumbnails/previews that should render inline in an <img> tag.
export const getPresignedViewUrl = async (key: string, expiresInSeconds = 3600): Promise<string> => {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
};
