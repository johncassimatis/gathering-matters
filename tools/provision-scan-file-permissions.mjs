#!/usr/bin/env node
// Idempotent Directus permission provisioning for Option A scan-gating.
//
// Codifies the PRIMARY control that keeps public users and ordinary staff from
// reading unscanned / non-clean files: folder-based `directus_files` read
// permissions. A file's FOLDER encodes its release state:
//   - "Pending Malware Scan"  -> no non-admin role can read it (default; fail closed)
//   - "Clean Staff Review"    -> only review roles (Moderator/Editor/Publisher)
//   - "Public Downloads"      -> staff may read through authenticated Directus
//                                permissions. Anonymous document downloads use
//                                /gm-library/downloads/:fileId so revocation is
//                                checked against current database state.
//
// The scan consumer (Increment 4) and editorial workflow (Increment 5) move files
// between folders. This script only manages folders + the read permissions.
//
// Design choices for safety / idempotency:
//   * All managed objects are marked with MANAGED_TAG in their name, so the script
//     NEVER reads, updates, or deletes any pre-existing policy / permission / access.
//   * Managed permissions live on DEDICATED managed policies (one per role), linked
//     to the role via a managed access row. Rollback = delete the managed policies
//     + their access rows (folders are left intact because they may contain files).
//   * `directus_files` reads are field-restricted to non-sensitive fields only
//     (never filename_disk / storage / metadata), so S3 keys are never exposed.
//   * Roles are resolved by exact name; missing or ambiguous => stop.
//   * `--dry-run` performs no writes.
//
// Env: DIRECTUS_URL, DIRECTUS_ADMIN_TOKEN.
// Flags: --dry-run | --report | --rollback | --revoke-public-assets |
//        --seed-roles (disposable test only)
//
// This script must NOT be run against production during the current task. It is
// meant to be applied later, to production, by an authorized operator, and then
// verified with a role-by-role smoke test.

const URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const DRY = process.argv.includes('--dry-run');
const REPORT = process.argv.includes('--report');
const ROLLBACK = process.argv.includes('--rollback');
const REVOKE_PUBLIC_ASSETS = process.argv.includes('--revoke-public-assets');
const SEED_ROLES = process.argv.includes('--seed-roles'); // disposable test env only

if (!URL || !TOKEN) {
  console.error('Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN.');
  process.exit(2);
}

const MANAGED_TAG = 'gm-scan-managed';
const FOLDERS = ['Pending Malware Scan', 'Clean Staff Review', 'Public Downloads'];
// Non-sensitive directus_files fields only. Never expose filename_disk/storage/metadata.
const SAFE_FILE_FIELDS = ['id', 'filename_download', 'title', 'type', 'filesize', 'width', 'height', 'duration'];

// Role -> folders whose files that role may read. There is deliberately no
// anonymous directus_files read policy: public documents use the request-time
// gated gm-library download endpoint. A file in "Public Downloads" is already
// clean AND editorially approved for authenticated staff access.
const ACCESS_MATRIX = {
  Contributor: ['Public Downloads'],
  Moderator:   ['Clean Staff Review', 'Public Downloads'],
  Editor:      ['Clean Staff Review', 'Public Downloads'],
  Publisher:   ['Clean Staff Review', 'Public Downloads'],
};
const REQUIRED_ROLES = ['Contributor', 'Moderator', 'Editor', 'Publisher'];

const changes = []; // audit of writes (or would-be writes under --dry-run)

async function dx(path, opts = {}) {
  const res = await fetch(URL + path, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message || res.statusText;
    throw new Error(`Directus ${opts.method || 'GET'} ${path} -> ${res.status}: ${msg}`);
  }
  return body?.data;
}
const write = async (label, path, opts) => {
  if (DRY) { changes.push({ dryRun: true, action: label, path }); return { id: `<dry-run:${label}>` }; }
  const data = await dx(path, opts);
  changes.push({ action: label, path, id: data?.id });
  return data;
};

const managedPolicyName = (role) => `${MANAGED_TAG}: file access (${role})`;

async function main() {
  // 1. Read current state (never mutate existing objects).
  const [roles, policies, access, folders] = await Promise.all([
    dx('/roles?fields=id,name&limit=-1'),
    dx('/policies?fields=id,name&limit=-1'),
    dx('/access?fields=id,role,policy,user&limit=-1'),
    dx('/folders?fields=id,name,parent&limit=-1'),
  ]);
  const roleByName = (name) => roles.filter((r) => r.name === name);

  if (SEED_ROLES && !DRY) {
    for (const rn of REQUIRED_ROLES) {
      if (roleByName(rn).length === 0) {
        const r = await write(`seed role ${rn}`, '/roles', { method: 'POST', body: JSON.stringify({ name: rn }) });
        roles.push({ id: r.id, name: rn });
      }
    }
  }

  if (ROLLBACK) return rollback(policies, access);

  // The earlier implementation used a managed anonymous policy for Directus
  // /assets. Remove only that exact managed policy when an operator explicitly
  // requests the revocation during deployment. The normal provisioning path
  // never touches it, so a missed flag cannot silently mutate existing access.
  if (REVOKE_PUBLIC_ASSETS) await revokePublicAssets(policies, access);

  // 2. Resolve required roles; stop on missing or ambiguous.
  for (const rn of REQUIRED_ROLES) {
    const m = roleByName(rn);
    if (m.length === 0) throw new Error(`Required role not found: "${rn}". Provision it (or use --seed-roles in a disposable env). Aborting; nothing changed.`);
    if (m.length > 1) throw new Error(`Ambiguous role name "${rn}" (${m.length} matches). Aborting; nothing changed.`);
  }

  // 3. Ensure managed folders (create missing). Never reuse a same-named folder that is nested.
  const folderId = {};
  for (const name of FOLDERS) {
    const existing = folders.filter((f) => f.name === name && !f.parent);
    if (existing.length > 1) throw new Error(`Ambiguous folder "${name}". Aborting.`);
    if (existing.length === 1) { folderId[name] = existing[0].id; continue; }
    const created = await write(`create folder ${name}`, '/folders', { method: 'POST', body: JSON.stringify({ name }) });
    folderId[name] = created.id;
  }

  // 4. For each entry in the access matrix, ensure a managed policy + its
  //    directus_files read permission (folder-scoped, field-restricted) + access link.
  const resultPolicies = {};
  for (const [role, allowedFolders] of Object.entries(ACCESS_MATRIX)) {
    const polName = managedPolicyName(role);
    let pol = policies.find((p) => p.name === polName);
    if (!pol) {
      pol = await write(`create policy ${polName}`, '/policies', {
        method: 'POST',
        body: JSON.stringify({ name: polName, app_access: role !== 'Public', admin_access: false, icon: 'shield' }),
      });
      policies.push({ id: pol.id, name: polName });
    }
    const policyId = pol.id;
    resultPolicies[role] = { name: polName, id: policyId };

    // desired folder filter (fail-closed: only these folders are readable)
    const folderIds = allowedFolders.map((f) => folderId[f]).filter(Boolean);
    const desiredFilter = { folder: { _in: folderIds } };

    // find the managed permission on this dedicated policy (any directus_files read on it is ours)
    const existingPerms = DRY ? [] : await dx(`/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=directus_files&filter[action][_eq]=read&fields=id,policy,collection,action,fields,permissions&limit=-1`);
    const permBody = { policy: policyId, collection: 'directus_files', action: 'read', fields: SAFE_FILE_FIELDS, permissions: desiredFilter, validation: null, presets: null };
    if (existingPerms.length === 0) {
      await write(`create directus_files read perm (${role})`, '/permissions', { method: 'POST', body: JSON.stringify(permBody) });
    } else {
      await write(`update directus_files read perm (${role})`, `/permissions/${existingPerms[0].id}`, { method: 'PATCH', body: JSON.stringify({ fields: SAFE_FILE_FIELDS, permissions: desiredFilter }) });
    }

    // ensure the access link (role -> managed policy). Public = role:null, user:null.
    const roleId = role === 'Public' ? null : roleByName(role)[0].id;
    const linked = access.find((a) => a.policy === policyId && a.role === roleId && !a.user);
    if (!linked) {
      const created = await write(`link access (${role})`, '/access', { method: 'POST', body: JSON.stringify({ role: roleId, policy: policyId, user: null }) });
      access.push({ id: created.id, role: roleId, policy: policyId, user: null });
    }
  }

  const report = {
    managed_tag: MANAGED_TAG,
    dry_run: DRY,
    folders: folderId,
    policies: resultPolicies,
    safe_file_fields: SAFE_FILE_FIELDS,
    access_matrix: ACCESS_MATRIX,
    changes,
  };
  console.log(JSON.stringify(report, null, 2));
}

async function rollback(policies, access) {
  // Remove managed policies + their access rows. Leave folders (may contain files).
  const managed = policies.filter((p) => p.name.startsWith(`${MANAGED_TAG}:`));
  for (const p of managed) {
    for (const a of access.filter((x) => x.policy === p.id)) {
      await write(`delete access ${a.id}`, `/access/${a.id}`, { method: 'DELETE' });
    }
    await write(`delete policy ${p.name}`, `/policies/${p.id}`, { method: 'DELETE' });
  }
  console.log(JSON.stringify({ rolled_back: managed.map((p) => p.name), note: 'Managed folders left intact (may contain files).', changes }, null, 2));
}

async function revokePublicAssets(policies, access) {
  const publicPolicyName = managedPolicyName('Public');
  const policy = policies.find((p) => p.name === publicPolicyName);
  if (!policy) {
    changes.push({ action: 'revoke public assets', result: 'no managed Public policy found' });
    return;
  }

  const permissions = DRY ? [] : await dx(`/permissions?filter[policy][_eq]=${policy.id}&limit=-1&fields=id,collection,action`);
  for (const permission of permissions) {
    await write(`delete public asset permission ${permission.id}`, `/permissions/${permission.id}`, { method: 'DELETE' });
  }
  for (const a of access.filter((x) => x.policy === policy.id)) {
    await write(`delete public asset access ${a.id}`, `/access/${a.id}`, { method: 'DELETE' });
  }
  await write(`delete public asset policy ${policy.id}`, `/policies/${policy.id}`, { method: 'DELETE' });
  console.log(JSON.stringify({ revoked_public_assets: true, policy: publicPolicyName, changes }, null, 2));
}

main().catch((err) => { console.error('PROVISIONING FAILED:', err.message); process.exit(1); });
