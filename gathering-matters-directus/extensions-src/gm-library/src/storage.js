import fs from 'node:fs';
import path from 'node:path';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

function safeFilename(value) {
  let name = String(value || 'download.bin').split(/[\\/]/).pop() || 'download.bin';
  name = name.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/[\r\n]/g, '_').replace(/^\.+/, '').trim();
  return name.slice(0, 200) || 'download.bin';
}

function s3Key(env, scan, file) {
  if (scan?.object_key) return String(scan.object_key).replace(/^\/+/, '');
  const root = String(env.STORAGE_S3_ROOT || '').replace(/^\/+|\/+$/g, '');
  const disk = String(file.filename_disk || '').replace(/^\/+/, '');
  return root ? `${root}/${disk}` : disk;
}

function setDownloadHeaders(res, file, length) {
  const name = safeFilename(file.filename_download || file.title);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (Number.isFinite(Number(length)) && Number(length) >= 0) res.setHeader('Content-Length', String(length));
}

function streamBody(body, res) {
  if (body && typeof body.pipe === 'function') {
    body.once?.('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
    body.pipe(res);
    return;
  }
  if (body && typeof body.transformToByteArray === 'function') {
    body.transformToByteArray().then((bytes) => res.end(Buffer.from(bytes))).catch(() => res.status(404).end());
    return;
  }
  throw new Error('storage driver did not return a readable body');
}

export async function streamStoredFile({ env, file, scan, res }) {
  const location = String(file.storage || env.STORAGE_LOCATIONS || 'local').split(',')[0].trim();
  if (location === 's3') {
    const bucket = String(scan?.bucket || env.STORAGE_S3_BUCKET || '').trim();
    if (!bucket) throw new Error('storage bucket is not configured');
    const credentials = env.STORAGE_S3_KEY && env.STORAGE_S3_SECRET
      ? { accessKeyId: env.STORAGE_S3_KEY, secretAccessKey: env.STORAGE_S3_SECRET }
      : undefined;
    const client = new S3Client({
      region: env.STORAGE_S3_REGION || 'us-west-2',
      ...(credentials ? { credentials } : {}),
    });
    const key = s3Key(env, scan, file);
    const current = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const currentEtag = current.ETag == null ? null : String(current.ETag).replace(/^"|"$/g, '');
    if (scan?.object_version_id && current.VersionId && scan.object_version_id !== current.VersionId) {
      throw new Error('stored object version is no longer current');
    }
    if (scan?.etag && currentEtag && String(scan.etag).replace(/^"|"$/g, '') !== currentEtag) {
      throw new Error('stored object etag is no longer current');
    }
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(scan?.object_version_id ? { VersionId: scan.object_version_id } : {}),
    }));
    setDownloadHeaders(res, file, response.ContentLength ?? file.filesize);
    streamBody(response.Body, res);
    return;
  }

  const root = path.resolve(env.STORAGE_LOCAL_ROOT || '/directus/uploads');
  const filename = String(file.filename_disk || '');
  const absolute = path.resolve(root, filename);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error('invalid storage path');
  const stat = await fs.promises.stat(absolute);
  setDownloadHeaders(res, file, stat.size);
  fs.createReadStream(absolute).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
}

export { safeFilename };
