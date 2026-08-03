// Pure unit tests for the public-upload document validator. No Directus/AWS.
// Run: node --test  (from the gm-intake extension dir)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, inspectOoxml, FileRejected, MAX_OOXML_ENTRIES } from '../src/file-validation.js';

const MAX = 10 * 1024 * 1024;
const pdf = (extra = 'x') => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(extra)]);
const accept = (args) => validateDocument({ maxBytes: MAX, ...args });
const rejects = (args) => assert.throws(() => validateDocument({ maxBytes: MAX, ...args }), FileRejected);

// --- Minimal STORED zip (real structure) so isZip + central-directory parsing run.
function makeZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data ?? '', 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(0, 8); // method store
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const local = Buffer.concat([lh, name, data]); locals.push(local);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name]));
    offset += local.length;
  }
  const cd = Buffer.concat(centrals); const cdOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
// Central-directory-only buffer with explicit sizes, for zip-bomb guard tests.
function makeCD(entries) {
  const centrals = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(e.c, 20); ch.writeUInt32LE(e.u, 24); ch.writeUInt16LE(name.length, 28);
    centrals.push(Buffer.concat([ch, name]));
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(0, 16);
  return Buffer.concat([cd, eocd]);
}
const docx = (parts = [['[Content_Types].xml', '<x/>'], ['word/document.xml', '<w/>']]) => makeZip(parts.map(([name, data]) => ({ name, data })));
const xlsx = () => makeZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'xl/workbook.xml', data: '<w/>' }]);
const pptx = () => makeZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'ppt/presentation.xml', data: '<p/>' }]);

test('accepts valid PDF', () => { assert.equal(accept({ filename: 'a.pdf', declaredMime: 'application/pdf', buffer: pdf() }).ext, 'pdf'); });
test('accepts valid DOCX/XLSX/PPTX', () => {
  assert.equal(accept({ filename: 'a.docx', declaredMime: '', buffer: docx() }).ext, 'docx');
  assert.equal(accept({ filename: 'a.xlsx', declaredMime: '', buffer: xlsx() }).ext, 'xlsx');
  assert.equal(accept({ filename: 'a.pptx', declaredMime: '', buffer: pptx() }).ext, 'pptx');
});
test('accepts plain TXT', () => { assert.equal(accept({ filename: 'n.txt', declaredMime: 'text/plain', buffer: Buffer.from('hello notes') }).ext, 'txt'); });

test('rejects images / csv / archives / legacy / macro / exe / script / html', () => {
  rejects({ filename: 'a.jpg', declaredMime: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
  rejects({ filename: 'a.png', declaredMime: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  rejects({ filename: 'a.csv', declaredMime: 'text/csv', buffer: Buffer.from('a,b,c') });
  rejects({ filename: 'a.zip', declaredMime: 'application/zip', buffer: makeZip([{ name: 'x', data: 'y' }]) });
  rejects({ filename: 'a.doc', declaredMime: 'application/msword', buffer: Buffer.from('legacy') });
  rejects({ filename: 'a.docm', declaredMime: '', buffer: docx() });
  rejects({ filename: 'a.exe', declaredMime: '', buffer: Buffer.from('MZ') });
  rejects({ filename: 'a.js', declaredMime: 'text/javascript', buffer: Buffer.from('alert(1)') });
  rejects({ filename: 'a.svg', declaredMime: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
});
test('rejects mismatched extension vs content', () => {
  rejects({ filename: 'notreally.pdf', declaredMime: 'application/pdf', buffer: Buffer.from('this is not a pdf') });
  rejects({ filename: 'fake.docx', declaredMime: '', buffer: Buffer.from('not a zip') });
});
test('rejects declared-mime that disagrees with extension', () => {
  rejects({ filename: 'a.pdf', declaredMime: 'application/vnd.ms-excel', buffer: pdf() });
});
test('rejects empty and oversized files', () => {
  rejects({ filename: 'a.pdf', declaredMime: 'application/pdf', buffer: Buffer.alloc(0) });
  rejects({ filename: 'a.pdf', declaredMime: 'application/pdf', buffer: pdf('x'.repeat(20 * 1024 * 1024)), });
});
test('rejects TXT with null bytes or active/markup content', () => {
  rejects({ filename: 'a.txt', declaredMime: 'text/plain', buffer: Buffer.from([0x68, 0x00, 0x69]) });
  rejects({ filename: 'a.txt', declaredMime: 'text/plain', buffer: Buffer.from('<!DOCTYPE html><html></html>') });
  rejects({ filename: 'a.txt', declaredMime: 'text/plain', buffer: Buffer.from('#!/bin/sh\nrm -rf') });
});
test('rejects OOXML missing required parts', () => {
  rejects({ filename: 'a.docx', declaredMime: '', buffer: docx([['[Content_Types].xml', '<x/>']]) }); // no word/document.xml
});
test('rejects OOXML with too many entries (count guard)', () => {
  const many = Array.from({ length: MAX_OOXML_ENTRIES + 1 }, (_, i) => ({ name: `e${i}.xml`, data: 'x' }));
  rejects({ filename: 'a.docx', declaredMime: '', buffer: makeZip(many) });
});
test('inspectOoxml enforces expanded-size and compression-ratio guards', () => {
  // ratio guard: 10 compressed -> 1,000,000 uncompressed (ratio 100000)
  assert.throws(() => inspectOoxml(makeCD([{ name: '[Content_Types].xml', c: 10, u: 1_000_000 }, { name: 'word/document.xml', c: 1, u: 1 }]), ['[Content_Types].xml', 'word/document.xml']), FileRejected);
  // expanded-size guard: total uncompressed over the ceiling
  assert.throws(() => inspectOoxml(makeCD([{ name: '[Content_Types].xml', c: 5_000_000, u: 400 * 1024 * 1024 }, { name: 'word/document.xml', c: 1, u: 1 }]), ['[Content_Types].xml', 'word/document.xml']), FileRejected);
});
