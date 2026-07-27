// Deploy the two corrected forms to NEW test pages in the Gathering Matters
// Framer project via the Framer Server API. Idempotent. Never modifies existing
// pages. Does NOT publish unless --publish is passed (held until CORS is set).
//
// Run: node --env-file=../../gathering-matters-directus/tag-sync/.env deploy.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const PUBLISH = process.argv.includes("--publish")
const PLACE = process.argv.includes("--place")

// framer-api is installed only in tag-sync/node_modules; import it by absolute path.
const framerApiEntry = path.join(
  here,
  "../../gathering-matters-directus/tag-sync/node_modules/framer-api/dist/index.js"
)
const { connect, isComponentInstanceNode } = await import(pathToFileURL(framerApiEntry).href)

const TARGETS = [
  {
    codeName: "PreservationProjectFormTest.tsx",
    file: "PreservationProjectForm.inlined.tsx",
    slug: "/listening-program-form-test",
  },
  {
    codeName: "YoungAdultInitiativeFormTest.tsx",
    file: "YoungAdultInitiativeForm.inlined.tsx",
    slug: "/young-adult-initiative-form-test",
  },
]
// Existing production form pages that must never be touched.
const PROTECTED = new Set(["/preservation-project-form", "/young-adult-initiative-form", "/"])

const framer = await connect(process.env.FRAMER_PROJECT, process.env.FRAMER_API_KEY)
console.log("connected to project:", (await framer.getProjectInfo()).name)

// Ensure the npm dependency the components need is available for compilation.
try {
  await framer.unstable_ensureMinimumDependencyVersion("libphonenumber-js", "1.11.0")
  console.log("dependency ensured: libphonenumber-js >= 1.11.0")
} catch (e) {
  console.log("ensureMinimumDependencyVersion warning:", e?.message || String(e))
}

const existingFiles = await framer.getCodeFiles()
const existingPages = await framer.getNodesWithType("WebPageNode")

for (const t of TARGETS) {
  const code = fs.readFileSync(path.join(here, t.file), "utf8")

  // 1) create or update the code file (idempotent by name)

  // 2) typecheck — abort this target if there are errors
  const diags = await framer.typecheckCode(t.codeName, code)
  const errors = (diags || []).filter((d) => (d.category ?? d.severity) === "error" || d.category === 1)
  console.log(`typecheck ${t.codeName}: ${(diags || []).length} diagnostic(s), ${errors.length} error(s)`)
  if ((diags || []).length) {
    for (const d of diags.slice(0, 8)) {
      console.log("   -", JSON.stringify({ text: d.text ?? d.messageText ?? d.message, category: d.category, code: d.code }))
    }
  }
  if (errors.length) {
    console.log(`SKIP placement for ${t.codeName} — fix typecheck errors first.`)
    continue
  }

  // 3) create or update the code file with its full designer-facing controls
  let cf = existingFiles.find((f) => f.name === t.codeName)
  if (cf) {
    cf = await cf.setFileContent(code)
    console.log(`code file updated: ${t.codeName} (${cf.id})`)
  } else {
    cf = await framer.createCodeFile(t.codeName, code)
    console.log(`code file created: ${t.codeName} (${cf.id})`)
  }

  // 4) component export insertURL
  const exp = cf.exports.find((e) => e.type === "component" && e.isDefaultExport)
    || cf.exports.find((e) => e.type === "component")
  if (!exp || !exp.insertURL) {
    console.log(`no component export/insertURL for ${t.codeName}:`, JSON.stringify(cf.exports))
    continue
  }

  // 5) create or reuse the test page (idempotent by slug; never touch others)
  if (PROTECTED.has(t.slug)) { console.log(`REFUSING protected slug ${t.slug}`); continue }
  let page = existingPages.find((p) => p.path === t.slug)
  if (page) {
    console.log(`page exists, reusing: ${t.slug} (${page.id})`)
  } else {
    page = await framer.createWebPage(t.slug)
    console.log(`page created: ${t.slug} (${page.id})`)
  }

  // 5) placement. Once the component instance exists on a page (placed here or in
  // the editor), updating the CODE FILE above already propagates new code to it —
  // no re-placement needed. Re-placing creates duplicate forms, and the editor may
  // nest the instance inside a Frame (not a direct page child), which a naive
  // "already present?" check misses. So placement is OFF unless --place is passed
  // AND the page currently has no direct-child component instance.
  if (PLACE) {
    const children = await page.getChildren()
    const hasInstance = children.some((c) => {
      try { return isComponentInstanceNode(c) } catch { return false }
    })
    if (hasInstance) {
      console.log(`component instance already present on ${t.slug} — skipping placement`)
    } else {
      const inst = await framer.addComponentInstance({ url: exp.insertURL, parentId: page.id })
      console.log(`placed component on ${t.slug}: instance ${inst?.id} — NOTE: verify it is not a duplicate; the editor may nest the real one in a Frame`)
    }
  } else {
    console.log(`placement skipped (no --place); code-file update propagates to the existing instance on ${t.slug}`)
  }
}

if (PUBLISH) {
  console.log("publishing…")
  const r = await framer.publish()
  console.log("published:", JSON.stringify(r))
} else {
  console.log("NOT publishing (no --publish). Pages are drafts until published.")
}
process.exit(0)
