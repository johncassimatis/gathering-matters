// gmFormValidation.ts
// Shared, framework-agnostic helpers for the Gathering Matters Framer forms.
// Both PreservationProjectForm (Listening Program) and YoungAdultInitiativeForm
// import from here. Pure functions + constants only — no React, no JSX — so the
// two forms can stay genuinely separate (different required fields and copy)
// while sharing validation/formatting/response logic.
//
// In Framer: create this as a code file named `gmFormValidation.ts` in the same
// project, then the two components import it with `./gmFormValidation`.

// libphonenumber-js via esm.sh. Framer rejects the bare "libphonenumber-js"
// specifier ("not a valid npm package"), but an esm.sh URL builds correctly
// through both the Framer editor and the Server API (verified). Version pinned
// for reproducibility. @ts-ignore: the URL module resolves at build time and
// the Framer editor pulls its types from esm.sh; the isolated Server-API
// typecheck can't see them (TS2307), so we suppress that one type-only error.
// @ts-ignore
import { parsePhoneNumberFromString, AsYouType } from "https://esm.sh/libphonenumber-js@1.13.9"

// Production endpoint. HTTPS is required — an http:// URL is blocked as mixed
// content on the published (HTTPS) Framer site.
export const GM_API_URL = "https://cms.gatheringmatters.com/gm-intake/submissions"

// Shared form CSS. Replicates Oaken's interaction-state model (field
// default/hover/focus/error/error-focus, error icon inside the input, button
// normal/hover/active/focus/disabled) adapted to Gathering Matters' palette
// sampled from the live site: dark-slate text #25313B, cream surface #FFFDF8,
// navy primary #1D1D7A, Manrope headings. Reproduces Oaken's composition (card
// container, centered heading with a rule, 16px vertical rhythm, 2-col name
// grid, prominent right-aligned button) with GM colors. Injected once per form
// via a <style> tag; the `gmf-` prefix scopes it.
export const GM_FORM_CSS = `
.gmf-card{box-sizing:border-box;width:100%;max-width:492px;background:#FFFDF8;border-radius:12px;box-shadow:inset 0 0 0 1px #EAE6DA,0 6px 18px rgba(20,30,45,.08);padding:24px 32px 28px;font-family:inherit;color:#25313B}
.gmf-heading{margin:0 0 16px;padding-bottom:16px;border-bottom:1.5px solid #E0E4E8;font-family:"Manrope",sans-serif;font-size:27px;line-height:1.2;font-weight:800;letter-spacing:-.015em;text-align:center;color:#25313B}
.gmf-form{display:flex;flex-direction:column;gap:16px;width:100%;margin:0}
.gmf-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.gmf-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.gmf-label{font-size:14px;line-height:1.43;font-weight:600;color:#25313B}
.gmf-optional{font-weight:400;color:#6B7280}
.gmf-control{position:relative;display:block}
.gmf-input,.gmf-select,.gmf-textarea{box-sizing:border-box;width:100%;padding:12px;font-size:16px;line-height:1.5;font-family:inherit;color:#25313B;background:#fff;border:0;border-radius:8px;box-shadow:inset 0 0 0 1px #D9DEE3;transition:box-shadow 160ms ease,background-color 160ms ease}
.gmf-input{height:48px}
.gmf-textarea{min-height:140px;resize:vertical;display:block}
.gmf-select{height:48px;-webkit-appearance:none;-moz-appearance:none;appearance:none;padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%2325313B' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:12px 8px}
.gmf-input:hover,.gmf-select:hover,.gmf-textarea:hover{box-shadow:inset 0 0 0 1px #B9C2CB}
.gmf-input:focus,.gmf-select:focus,.gmf-textarea:focus{outline:none;box-shadow:inset 0 0 0 1px #1D1D7A,0 0 0 3px rgba(29,29,122,.18)}
.gmf-field.gmf-has-error .gmf-input,.gmf-field.gmf-has-error .gmf-select,.gmf-field.gmf-has-error .gmf-textarea{background:#FDF4F4;box-shadow:inset 0 0 0 1px #B42318}
.gmf-field.gmf-has-error .gmf-input:focus,.gmf-field.gmf-has-error .gmf-select:focus,.gmf-field.gmf-has-error .gmf-textarea:focus{box-shadow:inset 0 0 0 1px #B42318,0 0 0 3px rgba(180,35,24,.16)}
.gmf-error-icon{display:none;position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none}
.gmf-field.gmf-has-error .gmf-error-icon{display:block}
.gmf-field.gmf-has-error .gmf-input{padding-right:40px}
/* textarea: right inset matches inputs; only vertical anchor differs (top-aligned) */
.gmf-control--textarea .gmf-error-icon{top:14px;transform:none}
/* select: on error, hide the chevron so the error icon sits at the SAME right:12px
   inset as every other field (icon replaces the chevron; base padding-right leaves
   room for either). Keeps all error icons aligned down the right edge. */
.gmf-field.gmf-has-error .gmf-select{background-image:none}
.gmf-error{margin:2px 0 0;font-size:13px;line-height:1.4;font-weight:600;color:#B42318}
.gmf-hint{margin:2px 0 0;font-size:13px;line-height:1.4;color:#5B6670}
.gmf-field.gmf-has-error .gmf-hint{display:none}
.gmf-consent{display:flex;flex-direction:column;gap:6px}
.gmf-checkbox-row{display:flex;gap:10px;align-items:flex-start}
.gmf-checkbox-row input{margin-top:3px;flex:0 0 auto;width:16px;height:16px;accent-color:#1D1D7A}
.gmf-checkbox-label{font-size:14px;line-height:1.45;color:#25313B}
.gmf-button{align-self:flex-end;margin-right:8px;min-width:220px;min-height:48px;padding:12px 24px;border:0;border-radius:24px;background:#1D1D7A;color:#fff;font-family:"Manrope",sans-serif;font-size:16px;font-weight:600;line-height:1.5;cursor:pointer;transition:background-color 160ms ease,box-shadow 160ms ease}
.gmf-button:hover{background:#17175F}
.gmf-button:active{background:#101043}
.gmf-button:focus-visible{outline:none;box-shadow:0 0 0 3px #FFFDF8,0 0 0 6px rgba(29,29,122,.55)}
.gmf-button:disabled{opacity:.7;cursor:default}
.gmf-form-error{margin:0;border-left:3px solid #B42318;background:rgba(180,35,24,.08);color:#7F1D1D;border-radius:6px;padding:12px 14px;font-size:14px;font-weight:600}
.gmf-honeypot{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.gmf-success{border:1px solid #CBE3D1;background:#EEF6F0;color:#1E4D2B;border-radius:8px;padding:24px;text-align:center;font-family:"Manrope",sans-serif}
@media(max-width:480px){.gmf-card{padding:20px 18px 24px}.gmf-row{grid-template-columns:1fr}.gmf-button{align-self:stretch;margin-right:0;width:100%}}
`

// Friendly label → backend machine value for `submitter_age_range` (the
// SUBMITTER'S OWN age, per the schema — not the submission's target audience,
// which is the separate `audience` column). The gm-intake endpoint's AGE_RANGES
// set is authoritative; the UI only ever submits the right-hand value.
export const AGE_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
    { label: "18–24", value: "18_24" },
    { label: "25–34", value: "25_34" },
    { label: "35–44", value: "35_44" },
    { label: "45–54", value: "45_54" },
    { label: "55–64", value: "55_64" },
    { label: "65+", value: "65_plus" },
]

// User-facing status messages. "Directus" is never surfaced to visitors.
export const MESSAGES = {
    connection:
        "Could not connect to the submission service. Please check your connection and try again.",
    rateLimited:
        "Too many submissions have been received recently. Please wait and try again.",
    server: "We couldn't submit your response right now. Please try again.",
    validationFallback:
        "Please review the highlighted fields and try again.",
}

// --- field validators -------------------------------------------------------

export const isBlank = (v: string) => v.trim().length === 0

// Same shape Oaken uses; trims before testing. type="email" alone is not relied on.
export const isValidEmail = (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

// Phone validation/formatting via libphonenumber-js (real per-country
// validation + canonical E.164), following Oaken's behavior:
//   - an explicit leading "+" is parsed/formatted as international;
//   - a US-shaped number (<=10 digits, or 11 starting with 1) is treated as US;
//   - a bare number too long to be US is treated as INTERNATIONAL by
//     synthesizing a leading "+", so international numbers auto-format without
//     the user typing "+". (While typing a bare international number it formats
//     as US up to 10 digits, then flips to international at the 11th — the
//     tradeoff of auto-detecting a country without an explicit "+".)
// The library still validates the result, so a bad guess is simply invalid.
const DEFAULT_COUNTRY = "US"

// Decide the string to feed libphonenumber: explicit "+" or a US-shaped number
// is used as-is (US default); a bare number too long for US gets a synthesized
// "+" so it parses/formats as international.
function phoneInputFor(startsWithPlus: boolean, digits: string): string {
    if (startsWithPlus) return `+${digits}`
    const hasNanpCountryCode = digits.startsWith("1")
    const nanpEligible =
        (hasNanpCountryCode && digits.length <= 11) || digits.length <= 10
    return nanpEligible ? digits : `+${digits}`
}

function parsePhone(value: string) {
    const raw = String(value || "")
    if (!raw) return null
    const startsWithPlus = raw.trim().startsWith("+")
    const digits = raw.replace(/\D/g, "")
    return parsePhoneNumberFromString(phoneInputFor(startsWithPlus, digits), DEFAULT_COUNTRY) || null
}

export function isValidPhone(value: string): boolean {
    const p = parsePhone(value)
    return Boolean(p && p.isValid())
}

// Canonical E.164 from the library (e.g. +14155550142, +442079460958); "" when invalid.
export function toE164(value: string): string {
    const p = parsePhone(value)
    return p ? p.number : ""
}

// Live/as-you-type formatting for a controlled input. Given the previous value
// and the raw value the browser produced after the user's edit, returns the
// reformatted value. US national numbers → (415) 555-0142; "+" numbers → the
// library's international grouping.
//
// Deletion treats formatting characters as non-content and avoids the "backspace
// trap": at 3 digits AsYouType emits "(916)"; a plain backspace there removes only
// the auto-added ")", which re-formatting would re-add. So when a backspace removed
// only a separator (digit count unchanged), we drop the last real DIGIT instead —
// one backspace deletes the digit and "(913)" → "91". The reformat is otherwise
// left intact, so deleting the "4" from "(913) 4" correctly shows "(913)".
export function formatPhoneOnEdit(previous: string, raw: string): string {
    const prev = String(previous || "")
    const next = String(raw || "")
    if (!next) return ""
    const deleting = next.length < prev.length
    const hasPlus = next.trim().startsWith("+") || prev.trim().startsWith("+")
    let digits = next.replace(/\D/g, "")
    if (deleting) {
        const prevDigits = prev.replace(/\D/g, "")
        // Backspace removed only a formatting char → delete the real digit too.
        if (digits.length === prevDigits.length && digits.length > 0) {
            digits = digits.slice(0, -1)
        }
    }
    return new AsYouType(DEFAULT_COUNTRY).input(phoneInputFor(hasPlus, digits))
}

// --- response handling ------------------------------------------------------

// Read a body without letting a parse failure masquerade as a network failure.
// Returns parsed JSON, or null for empty/non-JSON/malformed bodies.
export async function readJsonSafely(response: Response): Promise<any> {
    const text = await response.text().catch(() => "")
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

// Pull the machine-readable reason from a Directus error envelope, if present.
export function extractBackendReason(data: any): string {
    return (
        data?.errors?.[0]?.extensions?.reason ||
        data?.errors?.[0]?.message ||
        ""
    )
}

// Map a backend reason string to one of the shared field keys. Both forms use
// the same field names, so this mapping is shared. Returns null when unmappable.
export type GmFieldName =
    | "title"
    | "description"
    | "firstName"
    | "lastName"
    | "email"
    | "phone"
    | "ageGroup"
    | "consentReview"
    | "consentContact"

export function mapReasonToField(reason: string): GmFieldName | null {
    const r = reason.toLowerCase()
    if (r.includes("title")) return "title"
    if (r.includes("body")) return "description"
    if (r.includes("email")) return "email"
    if (r.includes("phone")) return "phone"
    if (r.includes("age")) return "ageGroup"
    if (r.includes("name")) return "firstName"
    if (r.includes("consent_to_contact") || r.includes("contact"))
        return "consentContact"
    if (r.includes("consent")) return "consentReview"
    return null
}

// Classify an HTTP response into an outcome the forms render consistently.
// 201/202 → success (202 also covers honeypot + duplicate; must look identical
// to a normal success). 400/422 → validation. 429 → rate. else → server.
export type Outcome =
    | { kind: "success" }
    | { kind: "validation"; field: GmFieldName | null }
    | { kind: "rate" }
    | { kind: "server" }

export function classifyResponse(status: number, data: any): Outcome {
    if (status === 201 || status === 202) return { kind: "success" }
    if (status === 400 || status === 422)
        return {
            kind: "validation",
            field: mapReasonToField(extractBackendReason(data)),
        }
    if (status === 429) return { kind: "rate" }
    return { kind: "server" }
}
