import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2 env vars missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are required',
    );
  }

  client = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });

  return client;
}

export async function put(
  key: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<{ sha256: string }> {
  const c = getClient();
  const bucket = process.env.R2_BUCKET!;

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  await c.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  return { sha256 };
}

export async function getSignedUrl(key: string, ttlSec = 86400): Promise<string> {
  const c = getClient();
  const bucket = process.env.R2_BUCKET!;

  return awsGetSignedUrl(c, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSec,
  });
}
