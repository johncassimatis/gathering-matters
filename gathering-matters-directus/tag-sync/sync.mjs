// gm-framer reconciliation: Directus -> Framer.
// Owns (custom side, runs alongside the official Directus plugin):
//   - Topics / Audiences / Regions collections + their multi-reference assignments
//   - REMOVAL of Framer content whose Directus UUID is no longer Framer-eligible
//   - REMOVAL of stale Framer Content Types that are inactive in Directus AND unreferenced
// Never touches plugin-owned content fields (title/body/summary/author/content-type/etc.),
// and never touches the FAQ or "How it works" collections.
//
// Env: DIRECTUS_URL, DIRECTUS_TOKEN (read-only), FRAMER_PROJECT, FRAMER_API_KEY (or FRAMER_KEY_FILE),
//      CONTENT_COLLECTION (default "Directus"), TYPES_COLLECTION (default "Content Types"),
//      MAX_DELETES (default 10)
// Flags: --dry-run (plan only) | --apply (default) | --force (override mass-deletion guard) | --publish
import { connect } from "framer-api";
import fs from "node:fs";

const DIRECTUS_URL = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const FRAMER_PROJECT = process.env.FRAMER_PROJECT;
const KEY_FILE = process.env.FRAMER_KEY_FILE;
const FRAMER_API_KEY = process.env.FRAMER_API_KEY
  || (KEY_FILE && fs.existsSync(KEY_FILE) && (fs.readFileSync(KEY_FILE, "utf8").match(/fr_[A-Za-z0-9]+/) || [])[0]) || "";
const CONTENT = process.env.CONTENT_COLLECTION || "Directus";
const TYPES = process.env.TYPES_COLLECTION || "Content Types";
const MAX_DELETES = Number(process.env.MAX_DELETES || 10);
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const PUBLISH = process.argv.includes("--publish");
const DIMS = [
  { dim: "topic", coll: "Topics", field: "topics" },
  { dim: "audience", coll: "Audiences", field: "audiences" },
  { dim: "region", coll: "Regions", field: "regions" },
];

if (!DIRECTUS_URL || !DIRECTUS_TOKEN || !FRAMER_PROJECT || !FRAMER_API_KEY) {
  console.error("Missing config (DIRECTUS_URL, DIRECTUS_TOKEN, FRAMER_PROJECT, FRAMER_API_KEY)."); process.exit(2);
}
const log = (...a) => console.log(...a);
const sameSet = (a, b) => a.length === b.length && new Set([...a, ...b]).size === new Set(a).size;

// ---- Directus reads (FAIL-CLOSED: any non-2xx throws and aborts the whole run before any write) ----
async function dx(path) {
  const r = await fetch(DIRECTUS_URL + path, { headers: { Authorization: "Bearer " + DIRECTUS_TOKEN } });
  if (!r.ok) throw new Error(`Directus read failed (${r.status}) for ${path} — aborting (fail-closed).`);
  const body = await r.json();
  if (!body || !Array.isArray(body.data)) throw new Error(`Directus returned unexpected shape for ${path} — aborting (fail-closed).`);
  return body.data;
}

// The read-only token is filtered server-side to Framer-eligible content + active tags/types,
// so what it returns IS the source-of-truth set.
const tags = await dx("/items/tag?fields=id,name,slug,dimension&limit=-1");
const junction = await dx("/items/content_item_tag?fields=content_item_id,tag_id&limit=-1");
const eligible = await dx("/items/content_item?fields=id&limit=-1");
const activeTypes = await dx("/items/content_type?fields=id,slug&limit=-1");
const eligibleIds = new Set(eligible.map((x) => x.id));
const activeTypeKeys = new Set([...activeTypes.map((t) => t.id), ...activeTypes.map((t) => t.slug)]);
const tagsByDim = { topic: [], audience: [], region: [] };
for (const t of tags) (tagsByDim[t.dimension] ||= []).push(t);
const activeTagIds = new Set(tags.map((t) => t.id));
const itemTagIds = new Map();
for (const j of junction) {
  if (!activeTagIds.has(j.tag_id)) continue;
  if (!itemTagIds.has(j.content_item_id)) itemTagIds.set(j.content_item_id, new Set());
  itemTagIds.get(j.content_item_id).add(j.tag_id);
}
log(`Directus (read-only): eligible content=${eligibleIds.size}, active types=${activeTypeKeys.size / 2}, active tags=${tags.length}, junction rows=${junction.length}`);

// ---- Framer ----
const framer = await connect(FRAMER_PROJECT, FRAMER_API_KEY);
let cols = await framer.getCollections();
const content = cols.find((c) => c.name === CONTENT);
if (!content) { console.error(`Framer content collection '${CONTENT}' not found.`); process.exit(2); }
const contentItems = await content.getItems();
const contentFields = await content.getFields();
const ctField = contentFields.find((f) => f.name === "Content Type Id");

// Resolve each Framer item's Directus content_item UUID. The official plugin stores it in the
// "Directus Id" field (formattedText, e.g. "<p dir=\"auto\">0199...</p>"); an older mapping used the
// UUID directly as the Framer slug. Try the field first, then a UUID-shaped slug. An item with
// NEITHER is not Directus-managed (manual/unrelated Framer record) and must never be deleted.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const directusIdField = contentFields.find((f) => f.name === "Directus Id");
if (!directusIdField) log(`WARNING: '${CONTENT}' has no "Directus Id" field — falling back to UUID-shaped slugs only.`);
const directusIdOf = (item) => {
  const raw = directusIdField ? item.fieldData[directusIdField.id]?.value : null;
  const m = raw && String(raw).match(UUID_RE);
  if (m) return m[0].toLowerCase();
  if (item.slug && UUID_RE.test(item.slug)) return item.slug.toLowerCase();
  return null;
};

const typesCol = cols.find((c) => c.name === TYPES);
const typeItems = typesCol ? await typesCol.getItems() : [];
log(`Framer '${CONTENT}': ${contentItems.length} items | '${TYPES}': ${typeItems.length} items`);

// ============ PLAN (no writes) ============
const plan = { tagOps: [], contentDeletes: [], typeDeletes: [] };

// content: delete only Framer items positively identified as Directus-managed (they carry a
// content_item UUID) whose UUID is no longer eligible in Directus. Items with no Directus UUID
// (manual/unrelated Framer records) are never touched.
const contentDeletes = contentItems.filter((i) => {
  const uid = directusIdOf(i);
  return uid !== null && !eligibleIds.has(uid);
});
plan.contentDeletes = contentDeletes;

// remaining content after deletion -> which content types stay referenced
const deleteSet = new Set(contentDeletes);
const remaining = contentItems.filter((i) => !deleteSet.has(i));
const referencedTypeKeys = new Set(remaining.map((i) => ctField && i.fieldData[ctField.id]?.value).filter(Boolean));
// stale types: not active in Directus AND not referenced by any remaining content
const typeDeletes = typeItems.filter((i) => !activeTypeKeys.has(i.slug) && !referencedTypeKeys.has(i.slug));
plan.typeDeletes = typeDeletes;

// tag collections plan (upserts + prunes) — computed to also count destructive tag prunes for the guard
const tagWork = [];
for (const { dim, coll, field } of DIMS) {
  let dc = cols.find((c) => c.name === coll);
  const existing = dc ? await dc.getItems() : [];
  const exBySlug = new Map(existing.map((i) => [i.slug, i]));
  const desired = tagsByDim[dim];
  const desiredSlugs = new Set(desired.map((t) => t.slug));
  const removals = existing.filter((i) => !desiredSlugs.has(i.slug));
  tagWork.push({ dim, coll, field, dc, existing, exBySlug, desired, removals });
  if (!dc) plan.tagOps.push(`create collection '${coll}'`);
  for (const t of desired) if (!exBySlug.has(t.slug)) plan.tagOps.push(`${coll}: add '${t.slug}'`);
  for (const r of removals) plan.tagOps.push(`${coll}: REMOVE '${r.slug}'`);
}

// ---- print plan ----
log("\n================ PLAN ================");
log(`content items to DELETE from '${CONTENT}': ${contentDeletes.length}`);
contentDeletes.slice(0, 50).forEach((i) => log(`   - ${i.slug}`));
log(`content types to DELETE from '${TYPES}': ${typeDeletes.length}`);
typeDeletes.forEach((i) => log(`   - ${i.slug}`));
log(`tag collection ops: ${plan.tagOps.length}`);
plan.tagOps.slice(0, 30).forEach((o) => log(`   - ${o}`));
log("=====================================");

// ---- MASS-DELETION GUARD ----
const tagRemovalCount = tagWork.reduce((n, w) => n + w.removals.length, 0);
const destructive = contentDeletes.length + typeDeletes.length + tagRemovalCount;
// Fraction guard: refuse to delete a large share of Directus-managed content even when under the
// absolute cap. This is the backstop that would have caught the id-scheme mismatch (delete all 9).
const managedCount = contentItems.filter((i) => directusIdOf(i) !== null).length;
const deleteFraction = managedCount ? contentDeletes.length / managedCount : 0;
const MAX_DELETE_FRACTION = Number(process.env.MAX_DELETE_FRACTION || 0.5);
const fractionTripped = contentDeletes.length >= 3 && deleteFraction > MAX_DELETE_FRACTION;
log(`destructive deletions planned: ${destructive} (content ${contentDeletes.length} + types ${typeDeletes.length} + tag-prunes ${tagRemovalCount}); guard limit ${MAX_DELETES}`);
if (fractionTripped) log(`content deletions = ${contentDeletes.length}/${managedCount} Directus-managed items (${(deleteFraction * 100).toFixed(0)}%), over MAX_DELETE_FRACTION ${MAX_DELETE_FRACTION}`);
const guardTripped = destructive > MAX_DELETES || fractionTripped;
if (guardTripped && !FORCE) {
  console.error(`\nABORT: mass-deletion guard tripped (deletions=${destructive} vs cap ${MAX_DELETES}; content fraction=${(deleteFraction * 100).toFixed(0)}% vs cap ${(MAX_DELETE_FRACTION * 100).toFixed(0)}%).`);
  console.error("Re-run with --force to authorize this large reconciliation intentionally.");
  process.exit(3);
}
if (guardTripped && FORCE) log(`(mass-deletion guard overridden by --force)`);

if (DRY_RUN) { log("\nDRY-RUN: no Framer writes performed."); process.exit(0); }

// ============ EXECUTE (safe order) ============
// 1) delete stale content first (frees content-type references)
if (contentDeletes.length) { await content.removeItems(contentDeletes.map((i) => i.id)); log(`deleted ${contentDeletes.length} stale content item(s)`); }

// 2) tag collections: ensure, upsert active tags, set assignments on remaining content, prune stale tags
for (const w of tagWork) {
  let { dim, coll, field, dc, exBySlug, desired, removals } = w;
  if (!dc) { dc = await framer.createCollection(coll); cols = await framer.getCollections(); }
  let nameField = (await dc.getFields()).find((f) => f.name === "Name");
  if (!nameField) nameField = (await dc.addFields([{ type: "string", name: "Name" }]))[0];
  for (const t of desired) {
    const ex = exBySlug.get(t.slug);
    const fd = { [nameField.id]: { type: "string", value: t.name } };
    if (ex) await dc.addItems([{ id: ex.id, fieldData: fd }]);
    else await dc.addItems([{ slug: t.slug, fieldData: fd }]);
  }
  if (!contentFields.some((f) => f.name === field)) await content.addFields([{ type: "multiCollectionReference", name: field, collectionId: dc.id }]);
  const fld = (await content.getFields()).find((f) => f.name === field);
  const nowItems = await dc.getItems();
  const slugToId = new Map(nowItems.map((i) => [i.slug, i.id]));
  const liveContent = await content.getItems(); // after content deletion
  for (const item of liveContent) {
    const ids = itemTagIds.get(directusIdOf(item)) || new Set();
    const want = desired.filter((t) => ids.has(t.id));
    const cur = (item.fieldData[fld.id]?.value) || [];
    if (!sameSet(cur, want.map((t) => t.slug))) {
      await content.addItems([{ id: item.id, fieldData: { [fld.id]: { type: "multiCollectionReference", value: want.map((t) => slugToId.get(t.slug)).filter(Boolean) } } }]);
    }
  }
  if (removals.length) await dc.removeItems(removals.map((i) => i.id));
}

// 3) delete stale, now-unreferenced content types
if (typeDeletes.length && typesCol) { await typesCol.removeItems(typeDeletes.map((i) => i.id)); log(`deleted ${typeDeletes.length} stale content type(s)`); }

log("\nRECONCILIATION APPLIED.");
if (PUBLISH) { const r = await framer.publish(); log("published:", r?.deployment?.id || "ok"); }
process.exit(0);
