// Authorization + identifier helpers for the authenticated staff scan-upload
// route (POST /gm-intake/staff-files). Pure and unit-testable; no I/O.
//
// The staff route is fail-closed: it is usable only when the feature flag is on
// AND the caller is either a Directus administrator (accountability.admin) or
// carries a role present in the GM_STAFF_FILE_UPLOAD_ROLE_IDS allowlist. Every
// other caller (anonymous, authenticated-but-unlisted, malformed accountability,
// direct-policy-only) is denied. There is deliberately no "any authenticated
// user" path.

export function parseRoleIds(value) {
  return new Set(String(value || '').split(',').map((v) => v.trim()).filter(Boolean));
}

// Returns { ok: boolean, reason: string }. `reason` is for server logs only and
// must never be returned to the caller.
export function authorizeStaffUpload(accountability, env) {
  if (!accountability || typeof accountability !== 'object') return { ok: false, reason: 'no accountability' };
  if (!accountability.user) return { ok: false, reason: 'unauthenticated' };
  if (accountability.admin === true) return { ok: true, reason: 'admin' };
  const allow = parseRoleIds(env && env.GM_STAFF_FILE_UPLOAD_ROLE_IDS);
  const role = accountability.role ? String(accountability.role) : '';
  if (role && allow.has(role)) return { ok: true, reason: 'allowlisted role' };
  return { ok: false, reason: 'role not authorized' };
}

// Canonical UUIDv7 (version nibble 7, RFC variant). Submission IDs are uuidv7();
// an optional submission association must reference a canonical v7 id. Returns
// the normalized lowercase id, or null.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function normalizeUuidV7(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return UUID_V7.test(lower) ? lower : null;
}
export function isCanonicalUuidV7(value) {
  return normalizeUuidV7(value) !== null;
}
