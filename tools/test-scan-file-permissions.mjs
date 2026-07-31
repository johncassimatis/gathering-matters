#!/usr/bin/env node
// Disposable-environment permission test for the Option A scan-gating layer.
//
// Proves the folder-based directus_files gating provisioned by
// provision-scan-file-permissions.mjs actually denies/permits /assets and /files
// correctly per role. Creates TEMPORARY test files (one per managed folder) and
// TEMPORARY per-role users with static tokens, runs assertions with each role's
// token (and anonymously for Public), then deletes all temporary objects.
//
// Requires a LICENSED Directus (custom permission rules). Run against a licensed,
// data-free environment. Env: DIRECTUS_URL, DIRECTUS_ADMIN_TOKEN.
//
// Never prints tokens. Exit code 0 only if every assertion passes.

const URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '');
const ADMIN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!URL || !ADMIN) { console.error('Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN.'); process.exit(2); }

const FOLDERS = ['Pending Malware Scan', 'Clean Staff Review', 'Public Downloads'];
const ROLES = ['Contributor', 'Moderator', 'Editor', 'Publisher'];
const rand = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

async function dxAdmin(path, opts = {}) {
  const res = await fetch(URL + path, { ...opts, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const t = await res.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch {}
  if (!res.ok) throw new Error(`admin ${opts.method || 'GET'} ${path} -> ${res.status}: ${b?.errors?.[0]?.message || res.statusText}`);
  return b?.data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// status of GET /assets or /files for a given bearer token (or none = public).
// Small delay + one retry on 429 so prod rate limiting does not corrupt results.
async function statusFor(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  await sleep(150);
  let res = await fetch(URL + path, { headers });
  if (res.status === 429) { await sleep(1500); res = await fetch(URL + path, { headers }); }
  return res.status;
}

const cleanup = { files: [], users: [] };
const results = [];
function assert(name, cond) { results.push({ name, pass: !!cond }); }

async function uploadFileToFolder(folderId, label) {
  const fd = new FormData();
  fd.append('folder', folderId);
  fd.append('title', label);
  fd.append('file', new Blob([`test bytes for ${label}`], { type: 'text/plain' }), `${label}.txt`);
  const res = await fetch(URL + '/files', { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` }, body: fd });
  const b = await res.json();
  if (!res.ok) throw new Error(`file upload failed: ${res.status} ${JSON.stringify(b?.errors)}`);
  cleanup.files.push(b.data.id);
  return b.data.id;
}

async function main() {
  // Resolve managed folder IDs by name
  const folders = await dxAdmin('/folders?fields=id,name&limit=-1');
  const fId = {};
  for (const n of FOLDERS) { const f = folders.find((x) => x.name === n && !x.parent); if (!f) throw new Error(`Managed folder missing: ${n}. Run provisioning first.`); fId[n] = f.id; }

  // Resolve roles
  const allRoles = await dxAdmin('/roles?fields=id,name&limit=-1');
  const roleId = {}; for (const r of ROLES) { const m = allRoles.find((x) => x.name === r); if (!m) throw new Error(`Role missing: ${r}`); roleId[r] = m.id; }

  // Create temporary test files, one per folder
  const fileIds = {
    pending: await uploadFileToFolder(fId['Pending Malware Scan'], `gmscantest-pending-${rand()}`),
    review: await uploadFileToFolder(fId['Clean Staff Review'], `gmscantest-review-${rand()}`),
    public: await uploadFileToFolder(fId['Public Downloads'], `gmscantest-public-${rand()}`),
  };

  // Create temporary per-role users with static tokens
  const roleToken = {};
  for (const r of ROLES) {
    const token = `gmscantest-${r}-${rand()}`;
    const u = await dxAdmin('/users', { method: 'POST', body: JSON.stringify({ email: `gm-scan-test-${r.toLowerCase()}-${rand()}@example.com`, password: rand() + 'Aa1!', role: roleId[r], token, status: 'active' }) });
    cleanup.users.push(u.id); roleToken[r] = token;
  }

  // Expected direct /assets access matrix. Anonymous document downloads are
  // intentionally denied even for Public Downloads; the public route is the
  // request-time gated /gm-library/downloads/:fileId endpoint.
  const reviewRoles = ['Moderator', 'Editor', 'Publisher'];
  const principals = [['Public', null], ...ROLES.map((r) => [r, roleToken[r]])];

  const OK = (s) => s === 200;
  const DENIED = (s) => s === 403 || s === 401 || s === 404;

  for (const [pname, tok] of principals) {
    // Pending file: denied for everyone
    assert(`/assets pending denied for ${pname}`, DENIED(await statusFor(`/assets/${fileIds.pending}`, tok)));
    // Clean Staff Review: allowed only for review roles
    const revStatus = await statusFor(`/assets/${fileIds.review}`, tok);
    if (reviewRoles.includes(pname)) assert(`/assets review ALLOWED for ${pname}`, OK(revStatus));
    else assert(`/assets review denied for ${pname}`, DENIED(revStatus));
    // Public Downloads: authenticated staff only; anonymous access uses the
    // custom download endpoint and must not use the raw Directus asset route.
    const pubStatus = await statusFor(`/assets/${fileIds.public}`, tok);
    if (pname === 'Public') assert(`/assets public denied for ${pname}`, DENIED(pubStatus));
    else assert(`/assets public ALLOWED for ${pname}`, OK(pubStatus));
    // Transformation variant follows the same permission (pending must still be denied)
    assert(`/assets pending?transform denied for ${pname}`, DENIED(await statusFor(`/assets/${fileIds.pending}?width=10&height=10`, tok)));
    // Direct /files metadata: pending denied
    assert(`/files pending denied for ${pname}`, DENIED(await statusFor(`/files/${fileIds.pending}`, tok)));
  }

  // Field restriction: a review role reading a review file must not receive filename_disk/storage
  const revTok = roleToken['Editor'];
  const fRes = await fetch(URL + `/files/${fileIds.review}?fields=*`, { headers: { Authorization: `Bearer ${revTok}` } });
  if (fRes.status === 200) {
    const fb = (await fRes.json())?.data || {};
    assert('review role cannot see filename_disk', !('filename_disk' in fb));
    assert('review role cannot see storage', !('storage' in fb));
  } else {
    assert('review role reads review-file metadata (200)', false);
  }

  // Known-UUID no-bypass is inherently covered: we requested real file UUIDs directly above.
  console.log(JSON.stringify({ results }, null, 2));
}

async function doCleanup() {
  for (const id of cleanup.files) { try { await dxAdmin(`/files/${id}`, { method: 'DELETE' }); } catch {} }
  for (const id of cleanup.users) { try { await dxAdmin(`/users/${id}`, { method: 'DELETE' }); } catch {} }
}

main()
  .then(async () => {
    await doCleanup();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} assertions passed.`);
    if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exit(1); }
    console.log('ALL PASSED. Temporary test files and users cleaned up.');
  })
  .catch(async (e) => { await doCleanup(); console.error('TEST HARNESS ERROR:', e.message); process.exit(1); });
