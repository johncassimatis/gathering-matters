// PreservationProjectForm.tsx  —  Listening Program submission form
// Framer Code Component. Paste into the Framer component of the same name.
//
// Posts JSON to the committed production gm-intake endpoint (metadata only — no
// file uploads; the multipart/attachment work is not deployed).
//
// Composition + interaction model mirror the Oaken consultation form (card
// container, centered heading with a rule, 16px rhythm, 2-col name grid,
// prominent right-aligned button; errors on Submit that clear on input; phone
// formats as-you-type; per-field error icon + message; field/button hover/
// focus/active/error/disabled states). Colors are Gathering Matters' own.
//
// Listening Program rules (confirmed):
//   - first + last name required; email REQUIRED (administrative contact)
//   - phone optional (US/NANP or international, validated when provided)
//   - consent_to_review required
//   - consent_to_contact OPTIONAL — the required email does NOT itself authorise
//     follow-up; the separate checkbox does
//   - age: "Your age range" = the SUBMITTER'S OWN age → submitter_age_range
//
// Requires the shared code file `gmFormValidation.ts` in the same Framer project.

import React, { useEffect, useRef, useState } from "react"
// @ts-ignore
import { parsePhoneNumberFromString, AsYouType } from "https://esm.sh/libphonenumber-js@1.13.9"

// ---- inlined from gmFormValidation.ts (see framer/ for the shared source) ----
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
/* Custom accessible listbox (replaces the native <select> so the open menu
   matches the GM form; the native popup can't be styled cross-browser). */
.gmf-select-wrap{position:relative}
.gmf-select-btn{box-sizing:border-box;display:flex;align-items:center;width:100%;height:48px;padding:12px 40px 12px 12px;font-size:16px;line-height:1.5;font-family:inherit;color:#25313B;text-align:left;background:#fff;border:0;border-radius:8px;box-shadow:inset 0 0 0 1px #D9DEE3;cursor:pointer;transition:box-shadow 160ms ease,background-color 160ms ease}
.gmf-select-btn:hover{box-shadow:inset 0 0 0 1px #B9C2CB}
.gmf-select-btn:focus-visible,.gmf-select-btn:focus{outline:none;box-shadow:inset 0 0 0 1px #1D1D7A,0 0 0 3px rgba(29,29,122,.18)}
.gmf-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmf-select-placeholder{flex:1;min-width:0;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmf-select-chevron{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;transition:transform 160ms ease}
.gmf-select-wrap[data-open="true"] .gmf-select-chevron{transform:translateY(-50%) rotate(180deg)}
.gmf-field.gmf-has-error .gmf-select-btn{background:#FDF4F4;box-shadow:inset 0 0 0 1px #B42318}
.gmf-field.gmf-has-error .gmf-select-btn:focus{box-shadow:inset 0 0 0 1px #B42318,0 0 0 3px rgba(180,35,24,.16)}
.gmf-field.gmf-has-error .gmf-select-chevron{display:none}
.gmf-listbox{position:absolute;z-index:30;top:calc(100% + 6px);left:0;right:0;margin:0;padding:6px;list-style:none;background:#FFFDF8;border-radius:10px;box-shadow:inset 0 0 0 1px #EAE6DA,0 12px 28px rgba(20,30,45,.16);max-height:264px;overflow-y:auto}
.gmf-option{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:6px;font-size:15px;line-height:1.3;color:#25313B;cursor:pointer;user-select:none}
.gmf-option.is-active{background:rgba(29,29,122,.10)}
.gmf-option.is-selected{font-weight:600}
.gmf-option.is-selected.is-active{background:rgba(29,29,122,.16)}
.gmf-option[aria-selected="true"]::after{content:"✓";margin-left:8px;color:#1D1D7A;font-weight:700}
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

// Format from digits. US/Canada uses Oaken's custom NANP formatting (NOT
// AsYouType, which renders a country code as a bare "1 (916)…"): the 10-digit
// national number shows as "(916) 533-8235"; a leading country code shows as
// "+1 (916) 533-8235" — never bare "1 (…)". International uses AsYouType with a
// synthesized "+". Canonical submission stays E.164 (see toE164), independent of
// this display — so autofilled "1 (916) 533-8235" still submits +19165338235.
function formatPhoneDigits(startsWithPlus: boolean, digits: string): string {
    const hasNanpCountryCode = digits.startsWith("1")
    const nanpEligible = startsWithPlus
        ? hasNanpCountryCode && digits.length <= 11
        : (hasNanpCountryCode && digits.length <= 11) || digits.length <= 10
    if (nanpEligible) {
        const nsn = hasNanpCountryCode ? digits.slice(1) : digits
        const prefix = hasNanpCountryCode ? "+1 " : ""
        if (nsn.length === 0) return prefix.trim()
        if (nsn.length < 4) return `${prefix}(${nsn}`
        if (nsn.length < 7) return `${prefix}(${nsn.slice(0, 3)}) ${nsn.slice(3)}`
        return `${prefix}(${nsn.slice(0, 3)}) ${nsn.slice(3, 6)}-${nsn.slice(6, 10)}`
    }
    return new AsYouType(DEFAULT_COUNTRY).input(`+${digits}`)
}

// Live/as-you-type formatting for a controlled input, given the previous value
// and the raw value the browser produced after the user's edit.
//
// Deletion treats formatting characters as non-content and avoids the "backspace
// trap": at 3 digits the display is "(916)"; a plain backspace there removes only
// the auto-added ")", which re-formatting would re-add. So when a backspace removed
// only a separator (digit count unchanged), we drop the last real DIGIT instead —
// one backspace deletes the digit and "(913)" → "91". The reformat is otherwise
// left intact, so deleting the "4" from "(913) 4" correctly shows "(913)".
export function formatPhoneOnEdit(previous: string, raw: string): string {
    const prev = String(previous || "")
    const next = String(raw || "")
    if (!next) return ""
    const deleting = next.length < prev.length
    const startsWithPlus = next.trim().startsWith("+") || prev.trim().startsWith("+")
    let digits = next.replace(/\D/g, "")
    if (deleting) {
        const prevDigits = prev.replace(/\D/g, "")
        // Backspace removed only a formatting char → delete the real digit too.
        if (digits.length === prevDigits.length && digits.length > 0) {
            digits = digits.slice(0, -1)
        }
    }
    return formatPhoneDigits(startsWithPlus, digits)
}

// Reformat a complete value (on blur, or after browser autofill, which can set
// the field without ordinary keystrokes). No deletion handling — just normalize.
export function formatPhoneValue(value: string): string {
    const raw = String(value || "")
    if (!raw) return ""
    return formatPhoneDigits(raw.trim().startsWith("+"), raw.replace(/\D/g, ""))
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
// ---- end inlined helpers ----

const HEADING = "Share a Gathering Idea"

function ErrorIcon() {
    return (
        <svg
            className="gmf-error-icon"
            width="21"
            height="20"
            viewBox="0 0 21 20"
            fill="none"
            aria-hidden="true"
        >
            <path
                d="M18.6921 19.8286H2.30614C1.9263 19.8286 1.54646 19.7324 1.2147 19.5545C0.67139 19.2612 0.277126 18.7756 0.0992267 18.1842C-0.0786727 17.5928 -0.0161674 16.9678 0.277126 16.4293L8.46531 1.21164C8.86918 0.461577 9.6481 0 10.4991 0C11.3502 0 12.1291 0.466385 12.533 1.21164L20.7259 16.4293C20.9086 16.7658 21 17.1408 21 17.5255C21 18.1409 20.7596 18.7227 20.3221 19.1554C19.8893 19.593 19.3124 19.8286 18.6921 19.8286ZM2.30614 18.29H18.6969C18.9037 18.29 19.096 18.2082 19.2402 18.064C19.3845 17.9198 19.4662 17.7274 19.4662 17.5207C19.4662 17.3957 19.4326 17.2659 19.3749 17.1553L11.1771 1.94247C10.9799 1.57705 10.6386 1.53859 10.4991 1.53859C10.3597 1.53859 10.0183 1.57705 9.82119 1.94247L1.6282 17.1601C1.53204 17.3428 1.508 17.5495 1.5705 17.7467C1.6282 17.9438 1.76283 18.1073 1.94073 18.2034C2.05131 18.2611 2.17632 18.29 2.30614 18.29Z"
                fill="#B42318"
            />
            <path
                d="M10.498 13.6356C10.0893 13.6356 9.74792 13.3135 9.72869 12.9048L9.45463 7.03895C9.45463 7.03414 9.45463 7.02933 9.45463 7.02452V7.00048C9.44982 6.42351 9.9114 5.95232 10.4884 5.94751C10.5076 5.94751 10.5268 5.94751 10.5461 5.94751C11.123 5.97155 11.5702 6.46198 11.5413 7.03895L11.2673 12.9048C11.248 13.3135 10.9067 13.6356 10.498 13.6356Z"
                fill="#B42318"
            />
            <path
                d="M10.4982 16.704C9.96935 16.704 9.53662 16.2713 9.53662 15.7424C9.53662 15.2135 9.96935 14.7808 10.4982 14.7808C11.0271 14.7808 11.4599 15.2135 11.4599 15.7424C11.4599 16.2713 11.0271 16.704 10.4982 16.704Z"
                fill="#B42318"
            />
        </svg>
    )
}

function ChevronIcon() {
    return (
        <svg
            className="gmf-select-chevron"
            width="12"
            height="8"
            viewBox="0 0 12 8"
            fill="none"
            aria-hidden="true"
        >
            <path
                d="M1 1.5L6 6.5L11 1.5"
                stroke="#25313B"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

interface GmSelectProps {
    id: string
    value: string
    placeholder: string
    options: ReadonlyArray<{ label: string; value: string }>
    invalid: boolean
    describedBy?: string
    buttonRef: React.RefObject<HTMLButtonElement>
    onSelect: (value: string) => void
}

// Accessible select-only combobox/listbox (ARIA APG pattern). Replaces the
// native <select> so the OPEN menu matches the GM form — the native popup can't
// be styled cross-browser. Keyboard: Up/Down, Home/End, Enter/Space, Escape,
// Tab, first-letter type-ahead; click-outside closes; focus returns to the
// button; the selected value still maps to the backend enum.
function GmSelect(props: GmSelectProps) {
    const { id, value, placeholder, options, invalid, describedBy, buttonRef, onSelect } = props
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)
    const wrapRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLUListElement>(null)

    const labelId = `${id}-label`
    const listId = `${id}-listbox`
    const optId = (i: number) => `${id}-opt-${i}`
    const selectedIndex = options.findIndex((o) => o.value === value)
    const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : ""

    function openList(to?: number) {
        setActiveIndex(to ?? (selectedIndex >= 0 ? selectedIndex : 0))
        setOpen(true)
    }
    function closeList(focusButton = true) {
        setOpen(false)
        setActiveIndex(-1)
        if (focusButton) buttonRef.current?.focus()
    }
    function choose(i: number) {
        const o = options[i]
        if (o) onSelect(o.value)
        closeList()
    }

    useEffect(() => {
        if (!open) return
        function onDoc(e: PointerEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false)
                setActiveIndex(-1)
            }
        }
        document.addEventListener("pointerdown", onDoc)
        return () => document.removeEventListener("pointerdown", onDoc)
    }, [open])

    useEffect(() => {
        if (open && activeIndex >= 0 && listRef.current) {
            const el = listRef.current.children[activeIndex] as
                | HTMLElement
                | undefined
            el?.scrollIntoView({ block: "nearest" })
        }
    }, [open, activeIndex])

    function onKeyDown(e: React.KeyboardEvent) {
        const k = e.key
        if (!open) {
            if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
                e.preventDefault()
                openList()
            }
            return
        }
        if (k === "ArrowDown") {
            e.preventDefault()
            setActiveIndex((i) =>
                Math.min(options.length - 1, (i < 0 ? selectedIndex : i) + 1)
            )
        } else if (k === "ArrowUp") {
            e.preventDefault()
            setActiveIndex((i) => Math.max(0, (i < 0 ? selectedIndex : i) - 1))
        } else if (k === "Home") {
            e.preventDefault()
            setActiveIndex(0)
        } else if (k === "End") {
            e.preventDefault()
            setActiveIndex(options.length - 1)
        } else if (k === "Enter" || k === " ") {
            e.preventDefault()
            if (activeIndex >= 0) choose(activeIndex)
        } else if (k === "Escape") {
            e.preventDefault()
            closeList()
        } else if (k === "Tab") {
            closeList(false)
        } else if (k.length === 1 && /\S/.test(k)) {
            const idx = options.findIndex((o) =>
                o.label.toLowerCase().startsWith(k.toLowerCase())
            )
            if (idx >= 0) setActiveIndex(idx)
        }
    }

    return (
        <div
            className="gmf-select-wrap"
            ref={wrapRef}
            data-open={open ? "true" : "false"}
        >
            <button
                type="button"
                id={id}
                ref={buttonRef}
                className="gmf-select-btn"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-labelledby={labelId}
                aria-activedescendant={
                    open && activeIndex >= 0 ? optId(activeIndex) : undefined
                }
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onClick={() => (open ? closeList() : openList())}
                onKeyDown={onKeyDown}
            >
                <span
                    className={
                        selectedLabel
                            ? "gmf-select-value"
                            : "gmf-select-placeholder"
                    }
                >
                    {selectedLabel || placeholder}
                </span>
            </button>
            <ChevronIcon />
            <ErrorIcon />
            {open && (
                <ul
                    className="gmf-listbox"
                    id={listId}
                    role="listbox"
                    ref={listRef}
                    aria-labelledby={labelId}
                >
                    {options.map((o, i) => (
                        <li
                            key={o.value}
                            id={optId(i)}
                            role="option"
                            aria-selected={o.value === value}
                            className={
                                "gmf-option" +
                                (i === activeIndex ? " is-active" : "") +
                                (o.value === value ? " is-selected" : "")
                            }
                            onMouseEnter={() => setActiveIndex(i)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => choose(i)}
                        >
                            <span>{o.label}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

interface Props {
    apiUrl: string
}

export default function PreservationProjectForm(props: Partial<Props>) {
    const apiUrl = props.apiUrl || GM_API_URL

    const [values, setValues] = useState({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        ageGroup: "",
        title: "",
        description: "",
        consentReview: false,
        consentContact: false,
        website: "", // honeypot
    })
    const [errors, setErrors] = useState<Partial<Record<GmFieldName, string>>>(
        {}
    )
    const [status, setStatus] = useState<
        "idle" | "submitting" | "success" | "error"
    >("idle")
    const [formError, setFormError] = useState("")

    const refs = {
        firstName: useRef<HTMLInputElement>(null),
        lastName: useRef<HTMLInputElement>(null),
        email: useRef<HTMLInputElement>(null),
        phone: useRef<HTMLInputElement>(null),
        ageGroup: useRef<HTMLButtonElement>(null),
        title: useRef<HTMLInputElement>(null),
        description: useRef<HTMLTextAreaElement>(null),
        consentReview: useRef<HTMLInputElement>(null),
        consentContact: useRef<HTMLInputElement>(null),
    } as const
    const successRef = useRef<HTMLDivElement>(null)

    // Clear a field's error as the user edits it (Oaken: errors clear on input).
    function update<K extends keyof typeof values>(
        key: K,
        value: (typeof values)[K]
    ) {
        setValues((prev) => ({ ...prev, [key]: value }))
        setErrors((prev) => {
            if (!(key in prev)) return prev
            const next = { ...prev }
            delete next[key as GmFieldName]
            return next
        })
        if (formError) setFormError("")
    }

    function validate(): Partial<Record<GmFieldName, string>> {
        const next: Partial<Record<GmFieldName, string>> = {}

        if (isBlank(values.firstName))
            next.firstName = "Please enter your first name."
        if (isBlank(values.lastName))
            next.lastName = "Please enter your last name."
        const fullName = [values.firstName.trim(), values.lastName.trim()]
            .filter(Boolean)
            .join(" ")
        if (fullName.length > 120)
            next.lastName = "Name must be 120 characters or fewer."

        const email = values.email.trim()
        if (isBlank(email)) next.email = "Please enter your email address."
        else if (!isValidEmail(email))
            next.email = "Enter a valid email address, such as name@example.com."

        if (!isBlank(values.phone) && !isValidPhone(values.phone))
            next.phone =
                "Enter a valid phone number, e.g. (555) 123-4567 or +44 20 7946 0958."

        if (isBlank(values.ageGroup))
            next.ageGroup = "Please select your age range."

        const title = values.title.trim()
        if (isBlank(values.title)) next.title = "Please enter a title."
        else if (title.length < 3)
            next.title = "Title must be at least 3 characters."
        else if (title.length > 160)
            next.title = "Title must be 160 characters or fewer."

        const body = values.description.trim()
        if (isBlank(values.description))
            next.description = "Please enter a description."
        else if (body.length < 20)
            next.description = "Description must be at least 20 characters."
        else if (body.length > 5000)
            next.description = "Description must be 5000 characters or fewer."

        if (!values.consentReview)
            next.consentReview =
                "Please confirm your submission may be reviewed."

        // consent_to_contact is optional for the Listening Program.
        return next
    }

    const ORDER: GmFieldName[] = [
        "firstName",
        "lastName",
        "email",
        "phone",
        "ageGroup",
        "title",
        "description",
        "consentReview",
        "consentContact",
    ]

    function focusFirst(errs: Partial<Record<GmFieldName, string>>) {
        const key = ORDER.find((k) => errs[k])
        const el = key ? refs[key].current : null
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" })
            el.focus({ preventScroll: true })
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (status === "submitting") return // logical duplicate-submit guard

        const found = validate()
        if (Object.keys(found).length > 0) {
            setErrors(found)
            setStatus("error")
            focusFirst(found)
            return
        }

        setErrors({})
        setFormError("")
        setStatus("submitting")

        const phone = values.phone.trim()
        const submitterName = [values.firstName.trim(), values.lastName.trim()]
            .filter(Boolean)
            .join(" ")
        const payload = {
            source: "listening_program",
            title: values.title,
            body: values.description,
            submitter_name: submitterName,
            submitter_email: values.email.trim(),
            submitter_phone: phone ? toE164(phone) || phone : "",
            submitter_age_range: values.ageGroup,
            consent_to_review: values.consentReview,
            consent_to_contact: values.consentContact,
            website: values.website,
        }

        let response: Response
        try {
            response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
        } catch {
            setStatus("error")
            setFormError(MESSAGES.connection)
            return
        }

        const data = await readJsonSafely(response)
        const outcome = classifyResponse(response.status, data)

        if (outcome.kind === "success") {
            setStatus("success")
            setErrors({})
            setFormError("")
            window.requestAnimationFrame(() => successRef.current?.focus())
            return
        }
        if (outcome.kind === "validation") {
            if (outcome.field) {
                setErrors((prev) => ({
                    ...prev,
                    [outcome.field!]: "Please check this field and try again.",
                }))
                setStatus("error")
                refs[outcome.field].current?.focus?.()
            } else {
                setStatus("error")
                setFormError(MESSAGES.validationFallback)
            }
            return
        }
        setStatus("error")
        setFormError(
            outcome.kind === "rate" ? MESSAGES.rateLimited : MESSAGES.server
        )
    }

    if (status === "success") {
        return (
            <div className="gmf-card">
                <style>{GM_FORM_CSS}</style>
                <h2 className="gmf-heading">{HEADING}</h2>
                <div
                    ref={successRef}
                    tabIndex={-1}
                    role="status"
                    aria-live="polite"
                    className="gmf-success"
                >
                    <h3 style={{ margin: 0 }}>Thank you!</h3>
                    <p style={{ margin: "8px 0 0" }}>
                        Your idea has been received for review.
                    </p>
                </div>
            </div>
        )
    }

    const fieldCls = (f: GmFieldName) =>
        "gmf-field" + (errors[f] ? " gmf-has-error" : "")
    const describedBy = (f: GmFieldName) => (errors[f] ? `${f}-error` : undefined)
    const err = (f: GmFieldName) =>
        errors[f] ? (
            <p className="gmf-error" id={`${f}-error`} role="alert">
                {errors[f]}
            </p>
        ) : null

    return (
        <div className="gmf-card">
            <style>{GM_FORM_CSS}</style>
            <h2 className="gmf-heading">{HEADING}</h2>

            <form className="gmf-form" onSubmit={handleSubmit} noValidate>
                {/* Honeypot — off-screen, off the tab order, not required. */}
                <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="gmf-honeypot"
                    value={values.website}
                    onChange={(e) => update("website", e.target.value)}
                />

                {/* Name row — First + Last (2-col grid, Oaken layout) */}
                <div className="gmf-row">
                    <div className={fieldCls("firstName")}>
                        <label className="gmf-label" htmlFor="lp-firstName">
                            First name
                        </label>
                        <div className="gmf-control">
                            <input
                                className="gmf-input"
                                id="lp-firstName"
                                ref={refs.firstName}
                                type="text"
                                autoComplete="given-name"
                                value={values.firstName}
                                aria-invalid={Boolean(errors.firstName)}
                                aria-describedby={describedBy("firstName")}
                                onChange={(e) =>
                                    update("firstName", e.target.value)
                                }
                            />
                            <ErrorIcon />
                        </div>
                        {err("firstName")}
                    </div>

                    <div className={fieldCls("lastName")}>
                        <label className="gmf-label" htmlFor="lp-lastName">
                            Last name
                        </label>
                        <div className="gmf-control">
                            <input
                                className="gmf-input"
                                id="lp-lastName"
                                ref={refs.lastName}
                                type="text"
                                autoComplete="family-name"
                                value={values.lastName}
                                aria-invalid={Boolean(errors.lastName)}
                                aria-describedby={describedBy("lastName")}
                                onChange={(e) =>
                                    update("lastName", e.target.value)
                                }
                            />
                            <ErrorIcon />
                        </div>
                        {err("lastName")}
                    </div>
                </div>

                {/* Email */}
                <div className={fieldCls("email")}>
                    <label className="gmf-label" htmlFor="lp-email">
                        Email address
                        <span className="gmf-optional">
                            {" "}
                            — used to administer your submission
                        </span>
                    </label>
                    <div className="gmf-control">
                        <input
                            className="gmf-input"
                            id="lp-email"
                            ref={refs.email}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            value={values.email}
                            aria-invalid={Boolean(errors.email)}
                            aria-describedby={describedBy("email")}
                            onChange={(e) => update("email", e.target.value)}
                        />
                        <ErrorIcon />
                    </div>
                    {err("email")}
                </div>

                {/* Phone — formats as you type; US or international */}
                <div className={fieldCls("phone")}>
                    <label className="gmf-label" htmlFor="lp-phone">
                        Phone number{" "}
                        <span className="gmf-optional">(optional)</span>
                    </label>
                    <div className="gmf-control">
                        <input
                            className="gmf-input"
                            id="lp-phone"
                            ref={refs.phone}
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={values.phone}
                            aria-invalid={Boolean(errors.phone)}
                            aria-describedby={
                                errors.phone ? "phone-error" : "lp-phone-hint"
                            }
                            onChange={(e) =>
                                update(
                                    "phone",
                                    formatPhoneOnEdit(
                                        values.phone,
                                        e.target.value
                                    )
                                )
                            }
                            onBlur={(e) =>
                                update("phone", formatPhoneValue(e.target.value))
                            }
                        />
                        <ErrorIcon />
                    </div>
                    <p className="gmf-hint" id="lp-phone-hint">
                        Include your country code for international numbers (e.g.
                        +44…).
                    </p>
                    {err("phone")}
                </div>

                {/* Age (submitter's own age) — accessible custom listbox */}
                <div className={fieldCls("ageGroup")}>
                    <label
                        className="gmf-label"
                        id="lp-ageGroup-label"
                        htmlFor="lp-ageGroup"
                    >
                        Your age range
                    </label>
                    <GmSelect
                        id="lp-ageGroup"
                        value={values.ageGroup}
                        placeholder="Select an age range"
                        options={AGE_OPTIONS}
                        invalid={Boolean(errors.ageGroup)}
                        describedBy={describedBy("ageGroup")}
                        buttonRef={refs.ageGroup}
                        onSelect={(v) => update("ageGroup", v)}
                    />
                    {err("ageGroup")}
                </div>

                {/* Title */}
                <div className={fieldCls("title")}>
                    <label className="gmf-label" htmlFor="lp-title">
                        Gathering idea title
                    </label>
                    <div className="gmf-control">
                        <input
                            className="gmf-input"
                            id="lp-title"
                            ref={refs.title}
                            type="text"
                            value={values.title}
                            aria-invalid={Boolean(errors.title)}
                            aria-describedby={describedBy("title")}
                            onChange={(e) => update("title", e.target.value)}
                        />
                        <ErrorIcon />
                    </div>
                    {err("title")}
                </div>

                {/* Description */}
                <div className={fieldCls("description")}>
                    <label className="gmf-label" htmlFor="lp-description">
                        Description
                    </label>
                    <div className="gmf-control gmf-control--textarea">
                        <textarea
                            className="gmf-textarea"
                            id="lp-description"
                            ref={refs.description}
                            value={values.description}
                            aria-invalid={Boolean(errors.description)}
                            aria-describedby={describedBy("description")}
                            onChange={(e) =>
                                update("description", e.target.value)
                            }
                        />
                        <ErrorIcon />
                    </div>
                    {err("description")}
                </div>

                {/* Review consent (required) */}
                <div className={fieldCls("consentReview")}>
                    <div className="gmf-checkbox-row">
                        <input
                            id="lp-consentReview"
                            ref={refs.consentReview}
                            type="checkbox"
                            checked={values.consentReview}
                            aria-invalid={Boolean(errors.consentReview)}
                            aria-describedby={describedBy("consentReview")}
                            onChange={(e) =>
                                update("consentReview", e.target.checked)
                            }
                        />
                        <label
                            className="gmf-checkbox-label"
                            htmlFor="lp-consentReview"
                        >
                            I agree that my submission may be reviewed by the
                            Gathering Matters team.
                        </label>
                    </div>
                    {err("consentReview")}
                </div>

                {/* Contact consent (optional for LP) */}
                <div className={fieldCls("consentContact")}>
                    <div className="gmf-checkbox-row">
                        <input
                            id="lp-consentContact"
                            ref={refs.consentContact}
                            type="checkbox"
                            checked={values.consentContact}
                            aria-invalid={Boolean(errors.consentContact)}
                            aria-describedby={describedBy("consentContact")}
                            onChange={(e) =>
                                update("consentContact", e.target.checked)
                            }
                        />
                        <label
                            className="gmf-checkbox-label"
                            htmlFor="lp-consentContact"
                        >
                            Optional: the Gathering Matters team may contact me
                            to follow up about this submission. (Your email is
                            used to administer the submission either way.)
                        </label>
                    </div>
                    {err("consentContact")}
                </div>

                {formError && (
                    <p
                        className="gmf-form-error"
                        role="alert"
                        aria-live="assertive"
                    >
                        {formError}
                    </p>
                )}

                <button
                    type="submit"
                    className="gmf-button"
                    disabled={status === "submitting"}
                >
                    {status === "submitting" ? "Submitting…" : "Submit idea"}
                </button>
            </form>
        </div>
    )
}

