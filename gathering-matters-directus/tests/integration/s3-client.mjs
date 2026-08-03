import { createRequire } from 'node:module';

const require = createRequire(new URL('../../extensions-src/gm-library/package.json', import.meta.url));
export const s3 = require('@aws-sdk/client-s3');

export function client() {
  return new s3.S3Client({
    endpoint: process.env.GM_MINIO_ENDPOINT,
    region: process.env.GM_MINIO_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.GM_MINIO_ACCESS_KEY,
      secretAccessKey: process.env.GM_MINIO_SECRET_KEY,
    },
  });
}
