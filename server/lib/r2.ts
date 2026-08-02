import fs from 'fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
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

// Lightweight connectivity check for System Health - confirms the bucket is
// reachable with the configured credentials without transferring any data.
export const checkR2Health = async (): Promise<{ healthy: boolean; latencyMs: number; error?: string }> => {
  const start = Date.now();
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message || 'R2 request failed' };
  }
};

export const uploadFileToR2 = async (localPath: string, key: string): Promise<void> => {
  const body = fs.createReadStream(localPath);
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
};

// For small in-memory uploads (e.g. a brand logo) where writing a temp file
// to disk first would be unnecessary overhead.
export const uploadBufferToR2 = async (buffer: Buffer, key: string, contentType?: string): Promise<void> => {
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
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

// Used by Duplicate Campaign so the copy gets its own independent object
// instead of sharing a storage key with the original (which would make
// deleting either campaign's attachment also break the other one).
export const copyObjectInR2 = async (sourceKey: string, destKey: string): Promise<void> => {
  await client.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
      Key: destKey,
    }),
  );
};

// Used when applying an account-level default attachment to a new campaign,
// where we need the object's size but don't keep a duplicate copy of it in
// the database (the R2 object itself is the source of truth).
export const getObjectSize = async (key: string): Promise<number> => {
  const result = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return result.ContentLength ?? 0;
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
