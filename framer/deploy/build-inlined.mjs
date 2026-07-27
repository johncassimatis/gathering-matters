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
const pieces = fs.readFileSync(path.join(srcDir, "GmCanvasPieces.tsx"), "utf8")
// The helper module imports libphonenumber-js from an esm.sh URL. Hoist that
// import out of the inlined body and place it with the component's own imports
// at the top of the combined file (ES imports must sit at module top level).
const libImportRe = /^(?:\/\/ @ts-ignore\n)?import \{[\s\S]*?\} from "https:\/\/esm\.sh\/[^"]+"\n/m
const libImportMatch = helpers.match(libImportRe)
const libImport = libImportMatch ? libImportMatch[0] : ""
const helperBody = helpers.replace(libImportRe, "")

// The canvas outlet/field pieces are kept as a separate readable source file
// in the repository, then inlined for Framer's isolated code-file runtime.
const pieceImports = [
    /^import React, [^\n]+\n/m,
    /^import \{ addPropertyControls, ControlType \} from "framer"\n/m,
    /^import \{ AGE_OPTIONS, GmFieldName \} from "\.\/gmFormValidation"\n/m,
]
const pieceBody = pieceImports.reduce((body, re) => body.replace(re, ""), pieces)

const importBlock = /^import \{\n[\s\S]*?\n\} from "\.\/gmFormValidation"\n/m
const piecesImportBlock = /^import \{\n[\s\S]*?\n\} from "\.\/GmCanvasPieces"\n/m

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
    + `// ---- inlined from GmCanvasPieces.tsx (see framer/ for the shared source) ----\n`
    + pieceBody.trimEnd()
    + `\n// ---- end inlined canvas pieces ----\n`
  code = code.replace(importBlock, replacement)
  code = code.replace(piecesImportBlock, "")

  // Keep Framer Property Controls in the inlined file so the actual project
  // exposes the same designer panel as the repository source component.
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

// Standalone, self-contained GmCanvasPieces code file. This is what designers
// connect to the controller's Canvas ComponentInstance outlets, so it must be a
// SEPARATE Framer code component (exports GmCanvasField / GmCanvasHeading /
// GmCanvasSubmitButton). Its only ./gmFormValidation dependency is AGE_OPTIONS
// and the GmFieldName type — inline both so the file has no relative import.
const ageOptions = (helpers.match(/^export const AGE_OPTIONS[\s\S]*?^\]$/m) || [""])[0]
const gmFieldName = (helpers.match(/^export type GmFieldName =[\s\S]*?"consentContact"$/m) || [""])[0]
if (!ageOptions || !gmFieldName) {
  throw new Error("Could not extract AGE_OPTIONS / GmFieldName from gmFormValidation.ts")
}
const piecesSelfContained =
  pieces.replace(
    /^import \{ AGE_OPTIONS, GmFieldName \} from "\.\/gmFormValidation"\n/m,
    `// ---- inlined from gmFormValidation.ts (self-contained for Framer) ----\n` +
    ageOptions + "\n" + gmFieldName + "\n" +
    `// ---- end inlined ----\n`
  )
fs.writeFileSync(path.join(here, "GmCanvasPieces.inlined.tsx"), piecesSelfContained)
console.log(`wrote GmCanvasPieces.inlined.tsx (${piecesSelfContained.length} bytes)`)
