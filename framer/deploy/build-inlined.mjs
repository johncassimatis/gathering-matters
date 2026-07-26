// Build self-contained Framer code-component files by inlining the shared
// gmFormValidation helpers into each component. Framer code files import each
// other by generated module URLs (not ./relative), so for a reliable headless
// deploy we inline the helpers; only the libphonenumber-js npm import remains
// (Framer resolves npm imports automatically). The 3-file structure in ../ is
// the clean repo reference.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, "..")

const helpers = fs.readFileSync(path.join(srcDir, "gmFormValidation.ts"), "utf8")
// The helper module imports libphonenumber-js from an esm.sh URL. Hoist that
// import out of the inlined body and place it with the component's own imports
// at the top of the combined file (ES imports must sit at module top level).
const libImportRe = /^(?:\/\/ @ts-ignore\n)?import \{[\s\S]*?\} from "https:\/\/esm\.sh\/[^"]+"\n/m
const libImportMatch = helpers.match(libImportRe)
const libImport = libImportMatch ? libImportMatch[0] : ""
const helperBody = helpers.replace(libImportRe, "")

const importBlock = /^import \{[\s\S]*?\} from "\.\/gmFormValidation"\n/m

function inline(componentFile) {
  let code = fs.readFileSync(path.join(srcDir, componentFile), "utf8")
  if (!importBlock.test(code)) {
    throw new Error(`No ./gmFormValidation import block found in ${componentFile}`)
  }
  const replacement =
    (libImport ? libImport + "\n" : "") +
    `// ---- inlined from gmFormValidation.ts (see framer/ for the shared source) ----\n` +
    helperBody.trimEnd() +
    `\n// ---- end inlined helpers ----\n`
  code = code.replace(importBlock, replacement)

  // Strip editor-only property controls for the deployed test build: Framer's
  // headless typecheck sandbox does not resolve `addPropertyControls`/`ControlType`
  // from "framer", and the controls are non-essential (the component uses default
  // props). The repo reference versions keep them.
  code = code.replace(/^import \{ addPropertyControls, ControlType \} from "framer"\n/m, "")
  code = code.replace(/\naddPropertyControls\(\w+,\s*\{[\s\S]*?\n\}\)\n/m, "\n")

  return code
}

for (const [src, out] of [
  ["PreservationProjectForm.tsx", "PreservationProjectForm.inlined.tsx"],
  ["YoungAdultInitiativeForm.tsx", "YoungAdultInitiativeForm.inlined.tsx"],
]) {
  const result = inline(src)
  fs.writeFileSync(path.join(here, out), result)
  console.log(`wrote ${out} (${result.length} bytes)`)
}
