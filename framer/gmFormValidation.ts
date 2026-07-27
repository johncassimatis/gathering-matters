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

// Designer-facing visual tokens. These deliberately contain only presentation
// concerns. Submission fields, validation, consent, anti-spam, and the API URL
// remain implementation details of the form components.
export type GmFormAlignment = "left" | "center" | "right"

export interface GmFormDesign {
    colors: {
        cardBackground: string
        cardBorder: string
        headingRule: string
        inputBackground: string
        text: string
        mutedText: string
        border: string
        borderHover: string
        focus: string
        accent: string
        accentHover: string
        accentActive: string
        buttonText: string
        error: string
        errorBackground: string
        formErrorBackground: string
        success: string
        successBackground: string
        successBorder: string
    }
    typography: {
        bodyFontFamily: string
        headingFontFamily: string
        bodySize: number
        labelSize: number
        helperSize: number
        headingSize: number
        headingWeight: number
        bodyLineHeight: number
        headingLineHeight: number
    }
    layout: {
        maxWidth: number
        cardRadius: number
        cardPaddingTop: number
        cardPaddingRight: number
        cardPaddingBottom: number
        cardPaddingLeft: number
        formGap: number
        fieldGap: number
        nameGap: number
        textareaMinHeight: number
        headingAlign: GmFormAlignment
        buttonAlign: GmFormAlignment
    }
    controls: {
        height: number
        radius: number
        padding: number
    }
    button: {
        minWidth: number
        height: number
        radius: number
        horizontalPadding: number
        fontSize: number
        fontWeight: number
    }
}

export type GmFormDesignInput = {
    [K in keyof GmFormDesign]?: Partial<GmFormDesign[K]>
}

export const GM_FORM_DESIGN_DEFAULTS: GmFormDesign = {
    colors: {
        cardBackground: "#FFFDF8",
        cardBorder: "#EAE6DA",
        headingRule: "#E0E4E8",
        inputBackground: "#FFFFFF",
        text: "#25313B",
        mutedText: "#5B6670",
        border: "#D9DEE3",
        borderHover: "#B9C2CB",
        focus: "#1D1D7A",
        accent: "#1D1D7A",
        accentHover: "#17175F",
        accentActive: "#101043",
        buttonText: "#FFFFFF",
        error: "#B42318",
        errorBackground: "#FDF4F4",
        formErrorBackground: "rgba(180,35,24,.08)",
        success: "#1E4D2B",
        successBackground: "#EEF6F0",
        successBorder: "#CBE3D1",
    },
    typography: {
        bodyFontFamily: "inherit",
        headingFontFamily: "Manrope, sans-serif",
        bodySize: 16,
        labelSize: 14,
        helperSize: 13,
        headingSize: 27,
        headingWeight: 800,
        bodyLineHeight: 1.5,
        headingLineHeight: 1.2,
    },
    layout: {
        maxWidth: 492,
        cardRadius: 12,
        cardPaddingTop: 24,
        cardPaddingRight: 32,
        cardPaddingBottom: 28,
        cardPaddingLeft: 32,
        formGap: 16,
        fieldGap: 6,
        nameGap: 16,
        textareaMinHeight: 140,
        headingAlign: "center",
        buttonAlign: "right",
    },
    controls: { height: 48, radius: 8, padding: 12 },
    button: {
        minWidth: 220,
        height: 48,
        radius: 24,
        horizontalPadding: 24,
        fontSize: 16,
        fontWeight: 600,
    },
}

export function resolveGmFormDesign(input: GmFormDesignInput = {}): GmFormDesign {
    return {
        colors: { ...GM_FORM_DESIGN_DEFAULTS.colors, ...(input.colors || {}) },
        typography: {
            ...GM_FORM_DESIGN_DEFAULTS.typography,
            ...(input.typography || {}),
        },
        layout: { ...GM_FORM_DESIGN_DEFAULTS.layout, ...(input.layout || {}) },
        controls: { ...GM_FORM_DESIGN_DEFAULTS.controls, ...(input.controls || {}) },
        button: { ...GM_FORM_DESIGN_DEFAULTS.button, ...(input.button || {}) },
    }
}

const px = (value: number) => `${value}px`
const align = (value: GmFormAlignment) =>
    value === "left" ? "flex-start" : value === "right" ? "flex-end" : "center"

export function gmFormStyleVars(design: GmFormDesign): Record<string, string> {
    const { colors, typography, layout, controls, button } = design
    return {
        "--gmf-card-max-width": px(layout.maxWidth),
        "--gmf-card-background": colors.cardBackground,
        "--gmf-card-border": colors.cardBorder,
        "--gmf-heading-rule": colors.headingRule,
        "--gmf-card-radius": px(layout.cardRadius),
        "--gmf-card-padding": `${px(layout.cardPaddingTop)} ${px(layout.cardPaddingRight)} ${px(layout.cardPaddingBottom)} ${px(layout.cardPaddingLeft)}`,
        "--gmf-form-gap": px(layout.formGap),
        "--gmf-field-gap": px(layout.fieldGap),
        "--gmf-name-gap": px(layout.nameGap),
        "--gmf-heading-align": layout.headingAlign,
        "--gmf-button-align": align(layout.buttonAlign),
        "--gmf-text": colors.text,
        "--gmf-muted-text": colors.mutedText,
        "--gmf-input-background": colors.inputBackground,
        "--gmf-border": colors.border,
        "--gmf-border-hover": colors.borderHover,
        "--gmf-focus": colors.focus,
        "--gmf-accent": colors.accent,
        "--gmf-accent-hover": colors.accentHover,
        "--gmf-accent-active": colors.accentActive,
        "--gmf-button-text": colors.buttonText,
        "--gmf-error": colors.error,
        "--gmf-error-background": colors.errorBackground,
        "--gmf-form-error-background": colors.formErrorBackground,
        "--gmf-success": colors.success,
        "--gmf-success-background": colors.successBackground,
        "--gmf-success-border": colors.successBorder,
        "--gmf-body-font": typography.bodyFontFamily,
        "--gmf-heading-font": typography.headingFontFamily,
        "--gmf-body-size": px(typography.bodySize),
        "--gmf-label-size": px(typography.labelSize),
        "--gmf-helper-size": px(typography.helperSize),
        "--gmf-heading-size": px(typography.headingSize),
        "--gmf-heading-weight": String(typography.headingWeight),
        "--gmf-body-line-height": String(typography.bodyLineHeight),
        "--gmf-heading-line-height": String(typography.headingLineHeight),
        "--gmf-control-height": px(controls.height),
        "--gmf-control-radius": px(controls.radius),
        "--gmf-control-padding": px(controls.padding),
        "--gmf-textarea-height": px(layout.textareaMinHeight),
        "--gmf-button-min-width": px(button.minWidth),
        "--gmf-button-height": px(button.height),
        "--gmf-button-radius": px(button.radius),
        "--gmf-button-padding": px(button.horizontalPadding),
        "--gmf-button-size": px(button.fontSize),
        "--gmf-button-weight": String(button.fontWeight),
    }
}

// Shared form CSS. Replicates Oaken's interaction-state model (field
// default/hover/focus/error/error-focus, error icon inside the input, button
// normal/hover/active/focus/disabled) adapted to Gathering Matters' palette
// sampled from the live site: dark-slate text #25313B, cream surface #FFFDF8,
// navy primary #1D1D7A, Manrope headings. Reproduces Oaken's composition (card
// container, centered heading with a rule, 16px vertical rhythm, 2-col name
// grid, prominent right-aligned button) with GM colors. Injected once per form
// via a <style> tag; the `gmf-` prefix scopes it.
export const GM_FORM_CSS = `
.gmf-card{box-sizing:border-box;width:100%;max-width:var(--gmf-card-max-width);background:var(--gmf-card-background);border-radius:var(--gmf-card-radius);box-shadow:inset 0 0 0 1px var(--gmf-card-border),0 6px 18px rgba(20,30,45,.08);padding:var(--gmf-card-padding);font-family:var(--gmf-body-font);color:var(--gmf-text)}
.gmf-heading{margin:0 0 16px;padding-bottom:16px;border-bottom:1.5px solid var(--gmf-heading-rule);font-family:var(--gmf-heading-font);font-size:var(--gmf-heading-size);line-height:var(--gmf-heading-line-height);font-weight:var(--gmf-heading-weight);letter-spacing:-.015em;text-align:var(--gmf-heading-align);color:var(--gmf-text)}
.gmf-form{display:flex;flex-direction:column;gap:var(--gmf-form-gap);width:100%;margin:0}
.gmf-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gmf-name-gap)}
.gmf-field{display:flex;flex-direction:column;gap:var(--gmf-field-gap);min-width:0}
.gmf-label{font-size:var(--gmf-label-size);line-height:1.43;font-weight:600;color:var(--gmf-text)}
.gmf-optional{font-weight:400;color:var(--gmf-muted-text)}
.gmf-control{position:relative;display:block}
.gmf-input,.gmf-select,.gmf-textarea{box-sizing:border-box;width:100%;padding:var(--gmf-control-padding);font-size:var(--gmf-body-size);line-height:var(--gmf-body-line-height);font-family:var(--gmf-body-font);color:var(--gmf-text);background:var(--gmf-input-background);border:0;border-radius:var(--gmf-control-radius);box-shadow:inset 0 0 0 1px var(--gmf-border);transition:box-shadow 160ms ease,background-color 160ms ease}
.gmf-input{height:var(--gmf-control-height)}
.gmf-textarea{min-height:var(--gmf-textarea-height);resize:vertical;display:block}
.gmf-select{height:48px;-webkit-appearance:none;-moz-appearance:none;appearance:none;padding-right:40px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%2325313B' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:12px 8px}
.gmf-input:hover,.gmf-select:hover,.gmf-textarea:hover{box-shadow:inset 0 0 0 1px var(--gmf-border-hover)}
.gmf-input:focus,.gmf-select:focus,.gmf-textarea:focus{outline:none;box-shadow:inset 0 0 0 1px var(--gmf-focus),0 0 0 3px rgba(29,29,122,.18)}
.gmf-field.gmf-has-error .gmf-input,.gmf-field.gmf-has-error .gmf-select,.gmf-field.gmf-has-error .gmf-textarea{background:var(--gmf-error-background);box-shadow:inset 0 0 0 1px var(--gmf-error)}
.gmf-field.gmf-has-error .gmf-input:focus,.gmf-field.gmf-has-error .gmf-select:focus,.gmf-field.gmf-has-error .gmf-textarea:focus{box-shadow:inset 0 0 0 1px var(--gmf-error),0 0 0 3px rgba(180,35,24,.16)}
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
.gmf-select-btn{box-sizing:border-box;display:flex;align-items:center;width:100%;height:var(--gmf-control-height);padding:var(--gmf-control-padding) 40px var(--gmf-control-padding) var(--gmf-control-padding);font-size:var(--gmf-body-size);line-height:var(--gmf-body-line-height);font-family:var(--gmf-body-font);color:var(--gmf-text);text-align:left;background:var(--gmf-input-background);border:0;border-radius:var(--gmf-control-radius);box-shadow:inset 0 0 0 1px var(--gmf-border);cursor:pointer;transition:box-shadow 160ms ease,background-color 160ms ease}
.gmf-select-btn:hover{box-shadow:inset 0 0 0 1px var(--gmf-border-hover)}
.gmf-select-btn:focus-visible,.gmf-select-btn:focus{outline:none;box-shadow:inset 0 0 0 1px var(--gmf-focus),0 0 0 3px rgba(29,29,122,.18)}
.gmf-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmf-select-placeholder{flex:1;min-width:0;color:var(--gmf-muted-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmf-select-chevron{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;transition:transform 160ms ease}
.gmf-select-wrap[data-open="true"] .gmf-select-chevron{transform:translateY(-50%) rotate(180deg)}
.gmf-field.gmf-has-error .gmf-select-btn{background:var(--gmf-error-background);box-shadow:inset 0 0 0 1px var(--gmf-error)}
.gmf-field.gmf-has-error .gmf-select-btn:focus{box-shadow:inset 0 0 0 1px var(--gmf-error),0 0 0 3px rgba(180,35,24,.16)}
.gmf-field.gmf-has-error .gmf-select-chevron{display:none}
.gmf-listbox{position:absolute;z-index:30;top:calc(100% + 6px);left:0;right:0;margin:0;padding:6px;list-style:none;background:var(--gmf-card-background);border-radius:10px;box-shadow:inset 0 0 0 1px var(--gmf-card-border),0 12px 28px rgba(20,30,45,.16);max-height:264px;overflow-y:auto}
.gmf-option{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:6px;font-size:15px;line-height:1.3;color:var(--gmf-text);cursor:pointer;user-select:none}
.gmf-option.is-active{background:rgba(29,29,122,.10)}
.gmf-option.is-selected{font-weight:600}
.gmf-option.is-selected.is-active{background:rgba(29,29,122,.16)}
.gmf-option[aria-selected="true"]::after{content:"✓";margin-left:8px;color:#1D1D7A;font-weight:700}
.gmf-error{margin:2px 0 0;font-size:var(--gmf-helper-size);line-height:1.4;font-weight:600;color:var(--gmf-error)}
.gmf-hint{margin:2px 0 0;font-size:var(--gmf-helper-size);line-height:1.4;color:var(--gmf-muted-text)}
.gmf-field.gmf-has-error .gmf-hint{display:none}
.gmf-consent{display:flex;flex-direction:column;gap:6px}
.gmf-checkbox-row{display:flex;gap:10px;align-items:flex-start}
.gmf-checkbox-row input{margin-top:3px;flex:0 0 auto;width:16px;height:16px;accent-color:var(--gmf-accent)}
.gmf-checkbox-label{font-size:var(--gmf-label-size);line-height:1.45;color:var(--gmf-text)}
.gmf-button{align-self:var(--gmf-button-align);margin-right:8px;min-width:var(--gmf-button-min-width);min-height:var(--gmf-button-height);padding:12px var(--gmf-button-padding);border:0;border-radius:var(--gmf-button-radius);background:var(--gmf-accent);color:var(--gmf-button-text);font-family:var(--gmf-heading-font);font-size:var(--gmf-button-size);font-weight:var(--gmf-button-weight);line-height:1.5;cursor:pointer;transition:background-color 160ms ease,box-shadow 160ms ease}
.gmf-button:hover{background:var(--gmf-accent-hover)}
.gmf-button:active{background:var(--gmf-accent-active)}
.gmf-button:focus-visible{outline:none;box-shadow:0 0 0 3px var(--gmf-card-background),0 0 0 6px rgba(29,29,122,.55)}
.gmf-button:disabled{opacity:.7;cursor:default}
.gmf-form-error{margin:0;border-left:3px solid var(--gmf-error);background:var(--gmf-form-error-background);color:var(--gmf-error);border-radius:6px;padding:12px 14px;font-size:var(--gmf-label-size);font-weight:600}
.gmf-honeypot{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.gmf-success{border:1px solid var(--gmf-success-border);background:var(--gmf-success-background);color:var(--gmf-success);border-radius:8px;padding:24px;text-align:center;font-family:var(--gmf-heading-font)}
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
