// Bounded, dependency-free validation for public document uploads (Option A).
//
// Public submissions accept ONLY: PDF, DOCX, PPTX, XLSX, TXT. Everything else
// (images, CSV, ODF, legacy/macro Office, archives, executables, scripts, HTML,
// active content) is rejected. Validation is BOUNDED: it reads magic bytes and,
// for OOXML, only the ZIP CENTRAL DIRECTORY (filenames + sizes) - it never
// inflates or parses untrusted entry contents, never extracts to disk, and never
// renders. This runs BEFORE malware scanning, so it must not process attacker
// content beyond bounded structural checks.
//
// Pure module: no Directus, AWS, or filesystem dependencies. Unit-testable.

export const MAX_OOXML_ENTRIES = 2000;
export const MAX_OOXML_UNCOMPRESSED = 300 * 1024 * 1024; // 300 MB expanded ceiling
export const MAX_OOXML_RATIO = 200;                      // per-entry compression ratio ceiling
const TXT_SNIFF = 8192;

// ext -> { mime, required OOXML parts (if any) }
export const ALLOWED = {
  pdf:  { mime: 'application/pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parts: ['[Content_Types].xml', 'word/document.xml'] },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', parts: ['[Content_Types].xml', 'ppt/presentation.xml'] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parts: ['[Content_Types].xml', 'xl/workbook.xml'] },
  txt:  { mime: 'text/plain' },
};

export class FileRejected extends Error {
  constructor(reason) { super(reason); this.name = 'FileRejected'; this.reason = reason; }
}

const extOf = (name) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};
const startsWith = (buf, bytes) => buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
const isPdf = (buf) => startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const isZip = (buf) => startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);       // PK\x03\x04

// Strip path components and unsafe chars; never used as a storage path.
export function sanitizeFilename(name, fallbackExt) {
  let base = String(name ?? '').split(/[\\/]/).pop() || '';
  base = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim();
  base = base.replace(/^[._]+/, '').slice(0, 200).trim();
  if (!base) base = `attachment.${fallbackExt}`;
  return base;
}

// Read the ZIP End-Of-Central-Directory record and iterate central-directory
// entries, collecting filenames + sizes. Reads metadata only; never inflates.
export function inspectOoxml(buf, requiredParts) {
  // Find EOCD signature PK\x05\x06 scanning back from the end (allow for comment).
  const EOCD = [0x50, 0x4b, 0x05, 0x06];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf[i] === EOCD[0] && buf[i + 1] === EOCD[1] && buf[i + 2] === EOCD[2] && buf[i + 3] === EOCD[3]) { eocd = i; break; }
  }
  if (eocd < 0) throw new FileRejected('not a valid zip (no end-of-central-directory)');
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total > MAX_OOXML_ENTRIES) throw new FileRejected(`too many zip entries (${total} > ${MAX_OOXML_ENTRIES})`);

  const names = new Set();
  let uncompressedTotal = 0;
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length) throw new FileRejected('malformed central directory');
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new FileRejected('malformed central-directory signature');
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);
    names.add(name);
    uncompressedTotal += uncompressed;
    if (uncompressedTotal > MAX_OOXML_UNCOMPRESSED) throw new FileRejected('expanded size exceeds limit (zip bomb guard)');
    if (compressed > 0 && uncompressed / compressed > MAX_OOXML_RATIO) throw new FileRejected('compression ratio exceeds limit (zip bomb guard)');
    p += 46 + fnLen + extraLen + commentLen;
  }
  for (const part of requiredParts) {
    if (!names.has(part)) throw new FileRejected(`not a valid OOXML package (missing ${part})`);
  }
  return { entries: total, uncompressedTotal };
}

// Reject binary or active-content masquerading as .txt (bounded sniff).
function validateTxt(buf) {
  const n = Math.min(buf.length, TXT_SNIFF);
  for (let i = 0; i < n; i++) if (buf[i] === 0x00) throw new FileRejected('text file contains null bytes (binary)');
  const head = buf.toString('utf8', 0, n).trimStart().toLowerCase();
  const active = ['<!doctype', '<html', '<script', '<?php', '<?xml', '#!/', '<%'];
  if (active.some((s) => head.startsWith(s))) throw new FileRejected('text file looks like active/markup content');
}

// Main entry point. Throws FileRejected on any problem; otherwise returns
// { ext, mime, safeName }. `maxBytes` is the configured per-file ceiling.
export function validateDocument({ filename, declaredMime, buffer, maxBytes }) {
  if (!buffer || buffer.length === 0) throw new FileRejected('empty file');
  if (maxBytes && buffer.length > maxBytes) throw new FileRejected(`file exceeds ${maxBytes} bytes`);

  const ext = extOf(filename);
  const spec = ALLOWED[ext];
  if (!spec) throw new FileRejected(`file type not allowed: .${ext || '(none)'}`);

  const mime = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  // Allow an empty/generic declared type, but a specific one must match the extension.
  if (mime && mime !== 'application/octet-stream' && mime !== spec.mime) {
    throw new FileRejected(`declared type ${mime} does not match .${ext}`);
  }

  if (ext === 'pdf') {
    if (!isPdf(buffer)) throw new FileRejected('content is not a PDF');
  } else if (ext === 'txt') {
    validateTxt(buffer);
  } else {
    // docx / pptx / xlsx
    if (!isZip(buffer)) throw new FileRejected(`content is not an OOXML (.${ext}) package`);
    inspectOoxml(buffer, spec.parts);
  }

  return { ext, mime: spec.mime, safeName: sanitizeFilename(filename, ext) };
}
