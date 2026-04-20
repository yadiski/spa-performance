import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

function getClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2 env vars missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET are required',
    );
  }

  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });
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

export async function get(key: string): Promise<Buffer> {
  const c = getClient();
  const bucket = process.env.R2_BUCKET!;

  const res = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

  if (!res.Body) {
    throw new Error(`R2 object not found or empty: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  // Body is a ReadableStream (web) or NodeJS stream — collect to buffer
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return buf;
}
