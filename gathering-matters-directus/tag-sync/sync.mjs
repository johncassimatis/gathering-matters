// Hybrid tag sync: Directus M2M tags -> Framer Topics/Audiences/Regions multi-reference fields.
// Read-only on Directus; writes ONLY the tag collections + 3 multi-ref fields on the content collection.
// Never touches plugin-owned content fields. Idempotent full reconcile.
//
// Env: DIRECTUS_URL, DIRECTUS_TOKEN (read-only), FRAMER_PROJECT, FRAMER_API_KEY (or key file), CONTENT_COLLECTION
// Flags: --dry-run (print plan, no writes) | --apply (default) | --publish (also publish the site)
import { connect } from "framer-api";
import fs from "node:fs";

const DIRECTUS_URL = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const FRAMER_PROJECT = process.env.FRAMER_PROJECT;
const KEY_FILE = process.env.FRAMER_KEY_FILE; // optional local convenience; env var is preferred
const FRAMER_API_KEY = process.env.FRAMER_API_KEY
  || (KEY_FILE && fs.existsSync(KEY_FILE) && (fs.readFileSync(KEY_FILE, "utf8").match(/fr_[A-Za-z0-9]+/) || [])[0])
  || "";
const CONTENT = process.env.CONTENT_COLLECTION || "Directus";
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const PUBLISH = process.argv.includes("--publish");

const DIMS = [ // Directus tag.dimension  ->  Framer collection name / field name
  { dim: "topic",    coll: "Topics",    field: "topics" },
  { dim: "audience", coll: "Audiences", field: "audiences" },
  { dim: "region",   coll: "Regions",   field: "regions" },
];

if (!DIRECTUS_URL || !DIRECTUS_TOKEN || !FRAMER_PROJECT || !FRAMER_API_KEY) {
  console.error("Missing config. Need DIRECTUS_URL, DIRECTUS_TOKEN, FRAMER_PROJECT, FRAMER_API_KEY(or key file)."); process.exit(2);
}
const log = (...a) => console.log(...a);
const plan = []; // human-readable planned changes

async function dx(path) {
  const r = await fetch(DIRECTUS_URL + path, { headers: { Authorization: "Bearer " + DIRECTUS_TOKEN } });
  if (!r.ok) throw new Error(`Directus ${path} -> ${r.status} ${await r.text()}`);
  return (await r.json()).data;
}

// ---------- 1. Read Directus (read-only) ----------
// The read token's permission already restricts `tag` to active rows (server-side filter),
// so we don't (and can't) filter on is_active here. Inactive tags simply don't appear and get pruned.
const tags = await dx("/items/tag?fields=id,name,slug,dimension&limit=-1");
const junction = await dx("/items/content_item_tag?fields=content_item_id,tag_id&limit=-1");
const activeIds = new Set(tags.map(t => t.id));
const tagsByDim = { topic: [], audience: [], region: [] };
for (const t of tags) (tagsByDim[t.dimension] ||= []).push(t);
const itemTagIds = new Map(); // content_item_id(uuid) -> Set(tag_id) [active only]
for (const j of junction) {
  if (!activeIds.has(j.tag_id)) continue;
  if (!itemTagIds.has(j.content_item_id)) itemTagIds.set(j.content_item_id, new Set());
  itemTagIds.get(j.content_item_id).add(j.tag_id);
}
log(`Directus (read-only): ${tags.length} active tags (topic=${tagsByDim.topic.length}, audience=${tagsByDim.audience.length}, region=${tagsByDim.region.length}); ${junction.length} junction rows; ${itemTagIds.size} items with tags.`);

// ---------- 2. Framer ----------
const framer = await connect(FRAMER_PROJECT, FRAMER_API_KEY);
let cols = await framer.getCollections();
const content = cols.find(c => c.name === CONTENT);
if (!content) { console.error(`Content collection '${CONTENT}' not found in Framer.`); process.exit(2); }
const contentItems = await content.getItems();
const contentFields = await content.getFields();
const bySlug = new Map(contentItems.map(i => [i.slug, i])); // slug == content_item UUID
log(`Framer '${CONTENT}': ${contentItems.length} items, ${contentFields.length} fields.`);

const sameSet = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

for (const { dim, coll, field } of DIMS) {
  // 2a. ensure dimension collection
  let dc = cols.find(c => c.name === coll);
  if (!dc) {
    plan.push(`CREATE collection '${coll}'`);
    if (!DRY_RUN) { dc = await framer.createCollection(coll); cols = await framer.getCollections(); }
  }
  // 2b. reconcile tag items in the dimension collection (keyed by slug)
  const desired = tagsByDim[dim]; // active tags for this dim
  // ensure a 'Name' field exists on the dimension collection (new collections have only a Slug)
  let nameField = dc ? (await dc.getFields()).find(f => f.name === "Name") : null;
  if (dc && !nameField) {
    plan.push(`  ${coll}: ADD field 'Name'`);
    if (!DRY_RUN) { const cr = await dc.addFields([{ type: "string", name: "Name" }]); nameField = cr[0]; }
  }
  const existingItems = dc ? await dc.getItems() : [];
  const exBySlug = new Map(existingItems.map(i => [i.slug, i]));
  // upserts
  for (const t of desired) {
    const ex = exBySlug.get(t.slug);
    if (!ex) plan.push(`  ${coll}: ADD tag '${t.slug}' (${t.name})`);
    else if (nameField && ex.fieldData[nameField.id]?.value !== t.name) plan.push(`  ${coll}: RENAME tag '${t.slug}' -> '${t.name}'`);
    if (!DRY_RUN && dc) {
      const fd = nameField ? { [nameField.id]: { type: "string", value: t.name } } : {};
      if (ex) await dc.addItems([{ id: ex.id, fieldData: fd }]);
      else await dc.addItems([{ slug: t.slug, fieldData: fd }]);
    }
  }
  // removals (inactive/deleted)
  const desiredSlugs = new Set(desired.map(t => t.slug));
  const staleIds = [];
  for (const i of existingItems) if (!desiredSlugs.has(i.slug)) { plan.push(`  ${coll}: REMOVE tag '${i.slug}'`); staleIds.push(i.id); }
  // 2c. ensure multi-ref field on content collection
  const hasField = contentFields.some(f => f.name === field);
  if (!hasField) {
    plan.push(`ADD field '${field}' (multiCollectionReference -> ${coll}) on '${CONTENT}'`);
    if (!DRY_RUN && dc) { await content.addFields([{ type: "multiCollectionReference", name: field, collectionId: dc.id }]); }
  }
  // 2d. slug->framerId map for this dim (re-read after upserts)
  const nowItems = dc && !DRY_RUN ? await dc.getItems() : existingItems;
  const slugToId = new Map(nowItems.map(i => [i.slug, i.id]));
  // 2e. set assignments on each content item
  // NB: a multiCollectionReference READS as an array of referenced-item slugs but is WRITTEN as ids.
  const fld = DRY_RUN ? contentFields.find(f => f.name === field) : (await content.getFields()).find(f => f.name === field);
  let changed = 0;
  for (const item of contentItems) {
    const tagIds = itemTagIds.get(item.slug) || new Set();   // item.slug == content_item UUID
    const dimTags = desired.filter(t => tagIds.has(t.id));
    const wantSlugs = dimTags.map(t => t.slug);
    const cur = (fld && item.fieldData[fld.id]?.value) || [];  // slugs
    if (!sameSet(cur, wantSlugs)) {
      changed++;
      if (!DRY_RUN) {
        const wantIds = dimTags.map(t => slugToId.get(t.slug)).filter(Boolean);
        await content.addItems([{ id: item.id, fieldData: { [fld.id]: { type: "multiCollectionReference", value: wantIds } } }]);
      }
    }
  }
  plan.push(`ASSIGN ${field}: ${changed} content item(s) ${DRY_RUN ? "would get" : "updated with"} ${dim} tags`);
  // 2f. prune stale tag items (after refs cleared)
  if (!DRY_RUN && dc && staleIds.length) await dc.removeItems(staleIds);
}

log("\n================ PLAN ================");
if (!plan.length) log("(no changes — Framer already matches Directus)");
else plan.forEach(p => log(" - " + p));
log("=====================================");
if (DRY_RUN) log("DRY-RUN: no Framer writes performed.");
else { log("APPLIED to Framer."); if (PUBLISH) { const r = await framer.publish(); log("published:", r?.deployment?.id || "ok"); } }
process.exit(0);
