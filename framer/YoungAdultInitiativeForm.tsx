// YoungAdultInitiativeForm.tsx  —  Young Adult Initiative submission form
// Framer Code Component. Paste into the Framer component of the same name.
//
// Posts JSON to the committed production gm-intake endpoint (metadata only).
//
// Composition + interaction model mirror the Oaken consultation form (card
// container, centered heading with a rule, 16px rhythm, 2-col name grid,
// prominent right-aligned button; errors on Submit that clear on input; phone
// formats as-you-type; per-field error icon + message; field/button hover/
// focus/active/error/disabled states). Colors are Gathering Matters' own.
//
// Young Adult Initiative rules (confirmed):
//   - first + last name required; email REQUIRED (follow-up is a core purpose)
//   - phone optional (US/NANP or international, validated when provided)
//   - one agreement checkbox (REQUIRED) covers review + contact
//   - a second checkbox (OPTIONAL) is marketing updates → consent_to_updates
//   - preferred follow-up method REQUIRED (email | phone | video)
//   - age: "Your age range" = the SUBMITTER'S OWN age → submitter_age_range,
//     restricted to the eligible 18–24 bucket for this programme
//   - one "About Gathering Initiative" field → body (a short title is derived)
//
// Requires the shared code file `gmFormValidation.ts` in the same Framer project.

import React, { useEffect, useRef, useState } from "react"
import { addPropertyControls, ControlType } from "framer"
import {
    GM_API_URL,
    GM_FORM_CSS,
    GM_FORM_DESIGN_DEFAULTS,
    GmFormDesignInput,
    gmFormStyleVars,
    resolveGmFormDesign,
    YAI_AGE_OPTIONS,
    FOLLOW_UP_OPTIONS,
    MESSAGES,
    isBlank,
    isValidEmail,
    isValidPhone,
    toE164,
    formatPhoneOnEdit,
    formatPhoneValue,
    readJsonSafely,
    classifyResponse,
    GmFieldName,
} from "./gmFormValidation"

const HEADING = "Share Your Initiative"

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
                fill="var(--gmf-error)"
            />
            <path
                d="M10.498 13.6356C10.0893 13.6356 9.74792 13.3135 9.72869 12.9048L9.45463 7.03895C9.45463 7.03414 9.45463 7.02933 9.45463 7.02452V7.00048C9.44982 6.42351 9.9114 5.95232 10.4884 5.94751C10.5076 5.94751 10.5268 5.94751 10.5461 5.94751C11.123 5.97155 11.5702 6.46198 11.5413 7.03895L11.2673 12.9048C11.248 13.3135 10.9067 13.6356 10.498 13.6356Z"
                fill="var(--gmf-error)"
            />
            <path
                d="M10.4982 16.704C9.96935 16.704 9.53662 16.2713 9.53662 15.7424C9.53662 15.2135 9.96935 14.7808 10.4982 14.7808C11.0271 14.7808 11.4599 15.2135 11.4599 15.7424C11.4599 16.2713 11.0271 16.704 10.4982 16.704Z"
                fill="var(--gmf-error)"
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
                stroke="var(--gmf-text)"
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
    apiUrl?: string
    design?: GmFormDesignInput
}

export default function YoungAdultInitiativeForm(props: Partial<Props>) {
    const apiUrl = props.apiUrl || GM_API_URL
    const design = resolveGmFormDesign(props.design)
    const visualStyle = gmFormStyleVars(design) as React.CSSProperties

    const [values, setValues] = useState({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        ageGroup: "",
        idea: "",
        followUp: "",
        consentAgree: false,
        consentUpdates: false,
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
        idea: useRef<HTMLTextAreaElement>(null),
        followUp: useRef<HTMLButtonElement>(null),
        consentAgree: useRef<HTMLInputElement>(null),
        consentUpdates: useRef<HTMLInputElement>(null),
    } as const
    const successRef = useRef<HTMLDivElement>(null)

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

        // Email REQUIRED for YAI.
        const email = values.email.trim()
        if (isBlank(email)) next.email = "Please enter your email address."
        else if (!isValidEmail(email))
            next.email = "Enter a valid email address, such as name@example.com."

        if (!isBlank(values.phone) && !isValidPhone(values.phone))
            next.phone =
                "Enter a valid phone number, e.g. (555) 123-4567 or +44 20 7946 0958."

        if (isBlank(values.ageGroup))
            next.ageGroup = "Please select your age range."

        const idea = values.idea.trim()
        if (isBlank(values.idea))
            next.idea = "Please tell us about your initiative."
        else if (idea.length < 20)
            next.idea = "Please use at least 20 characters."
        else if (idea.length > 5000)
            next.idea = "Please use 5000 characters or fewer."

        if (isBlank(values.followUp))
            next.followUp = "Please choose a preferred follow-up method."

        if (!values.consentAgree)
            next.consentAgree = "Please confirm you agree before submitting."

        // Updates consent (consentUpdates) is optional and never blocks submit.
        return next
    }

    const ORDER: GmFieldName[] = [
        "firstName",
        "lastName",
        "email",
        "phone",
        "ageGroup",
        "idea",
        "followUp",
        "consentAgree",
        "consentUpdates",
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
        const idea = values.idea.trim()
        const submitterName = [values.firstName.trim(), values.lastName.trim()]
            .filter(Boolean)
            .join(" ")
        // Derive a short title from the idea so the current endpoint (which still
        // requires a title) keeps accepting submissions; Phase 3 can relax this.
        const derivedTitle = idea.replace(/\s+/g, " ").slice(0, 120)
        const payload = {
            source: "young_adult_initiative",
            title: derivedTitle,
            body: idea,
            submitter_name: submitterName,
            submitter_email: values.email.trim(),
            submitter_phone: phone ? toE164(phone) || phone : "",
            submitter_age_range: values.ageGroup, // the submitter's own age
            preferred_follow_up: values.followUp,
            // One required agreement checkbox authorises both review and contact.
            consent_to_review: values.consentAgree,
            consent_to_contact: values.consentAgree,
            // Optional marketing consent — separate field, never blocks submit.
            consent_to_updates: values.consentUpdates,
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
            <div className="gmf-card" style={visualStyle}>
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
                        Your initiative has been received. We'll be in touch
                        about next steps.
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
        <div className="gmf-card" style={visualStyle}>
            <style>{GM_FORM_CSS}</style>
            <h2 className="gmf-heading">{HEADING}</h2>

            <form className="gmf-form" onSubmit={handleSubmit} noValidate>
                <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="gmf-honeypot"
                    value={values.website}
                    onChange={(e) => update("website", e.target.value)}
                />

                {/* Name row — First + Last (2-col grid) */}
                <div className="gmf-row">
                    <div className={fieldCls("firstName")}>
                        <label className="gmf-label" htmlFor="yai-firstName">
                            First name
                        </label>
                        <div className="gmf-control">
                            <input
                                className="gmf-input"
                                id="yai-firstName"
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
                        <label className="gmf-label" htmlFor="yai-lastName">
                            Last name
                        </label>
                        <div className="gmf-control">
                            <input
                                className="gmf-input"
                                id="yai-lastName"
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

                {/* Email (required) */}
                <div className={fieldCls("email")}>
                    <>
                    <label className="gmf-label" htmlFor="yai-email">
                        Email address
                    </label>
                    <div className="gmf-control">
                        <input
                            className="gmf-input"
                            id="yai-email"
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
                    </>
                </div>

                {/* Phone — formats as you type; US or international */}
                <div className={fieldCls("phone")}>
                    <>
                    <label className="gmf-label" htmlFor="yai-phone">
                        Phone number{" "}
                        <span className="gmf-optional">(optional)</span>
                    </label>
                    <div className="gmf-control">
                        <input
                            className="gmf-input"
                            id="yai-phone"
                            ref={refs.phone}
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={values.phone}
                            aria-invalid={Boolean(errors.phone)}
                            aria-describedby={
                                errors.phone ? "phone-error" : "yai-phone-hint"
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
                    <p className="gmf-hint" id="yai-phone-hint">
                        Include your country code for international numbers (e.g.
                        +44…).
                    </p>
                    {err("phone")}
                    </>
                </div>

                {/* Age (submitter's own age) — accessible custom listbox */}
                <div className={fieldCls("ageGroup")}>
                    <>
                    <label
                        className="gmf-label"
                        id="yai-ageGroup-label"
                        htmlFor="yai-ageGroup"
                    >
                        Your age range
                    </label>
                    <GmSelect
                        id="yai-ageGroup"
                        value={values.ageGroup}
                        placeholder="Select an age range"
                        options={YAI_AGE_OPTIONS}
                        invalid={Boolean(errors.ageGroup)}
                        describedBy={describedBy("ageGroup")}
                        buttonRef={refs.ageGroup}
                        onSelect={(v) => update("ageGroup", v)}
                    />
                    {err("ageGroup")}
                    </>
                </div>

                {/* About Gathering Initiative (single field → body) */}
                <div className={fieldCls("idea")}>
                    <label className="gmf-label" htmlFor="yai-idea">
                        About Gathering Initiative
                    </label>
                    <div className="gmf-control gmf-control--textarea">
                        <textarea
                            className="gmf-textarea"
                            id="yai-idea"
                            ref={refs.idea}
                            placeholder="Tell us about your initiative."
                            value={values.idea}
                            aria-invalid={Boolean(errors.idea)}
                            aria-describedby={describedBy("idea")}
                            onChange={(e) => update("idea", e.target.value)}
                        />
                        <ErrorIcon />
                    </div>
                    {err("idea")}
                </div>

                {/* Preferred follow-up method (required) — accessible listbox */}
                <div className={fieldCls("followUp")}>
                    <label
                        className="gmf-label"
                        id="yai-followUp-label"
                        htmlFor="yai-followUp"
                    >
                        Preferred follow-up method
                    </label>
                    <GmSelect
                        id="yai-followUp"
                        value={values.followUp}
                        placeholder="Select a follow-up method"
                        options={FOLLOW_UP_OPTIONS}
                        invalid={Boolean(errors.followUp)}
                        describedBy={describedBy("followUp")}
                        buttonRef={refs.followUp}
                        onSelect={(v) => update("followUp", v)}
                    />
                    {err("followUp")}
                </div>

                {/* Agreement consent (required) — covers review + contact */}
                <div className={fieldCls("consentAgree")}>
                    <div className="gmf-checkbox-row">
                        <input
                            id="yai-consentAgree"
                            ref={refs.consentAgree}
                            type="checkbox"
                            checked={values.consentAgree}
                            aria-invalid={Boolean(errors.consentAgree)}
                            aria-describedby={describedBy("consentAgree")}
                            onChange={(e) =>
                                update("consentAgree", e.target.checked)
                            }
                        />
                        <label
                            className="gmf-checkbox-label"
                            htmlFor="yai-consentAgree"
                        >
                            I agree that Gathering Matters may review my
                            submission and contact me about it.
                        </label>
                    </div>
                    {err("consentAgree")}
                </div>

                {/* Updates consent (optional) */}
                <div className={fieldCls("consentUpdates")}>
                    <div className="gmf-checkbox-row">
                        <input
                            id="yai-consentUpdates"
                            ref={refs.consentUpdates}
                            type="checkbox"
                            checked={values.consentUpdates}
                            aria-invalid={Boolean(errors.consentUpdates)}
                            aria-describedby={describedBy("consentUpdates")}
                            onChange={(e) =>
                                update("consentUpdates", e.target.checked)
                            }
                        />
                        <label
                            className="gmf-checkbox-label"
                            htmlFor="yai-consentUpdates"
                        >
                            I'd like to receive updates from Gathering Matters.
                        </label>
                    </div>
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
                    {status === "submitting"
                        ? "Submitting…"
                        : "Submit initiative"}
                </button>
            </form>
        </div>
    )
}

addPropertyControls(YoungAdultInitiativeForm, {
    design: {
        type: ControlType.Object,
        title: "Design",
        controls: {
            colors: {
                type: ControlType.Object,
                title: "Colors",
                controls: {
                    cardBackground: { type: ControlType.Color, title: "Card", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.cardBackground },
                    cardBorder: { type: ControlType.Color, title: "Card border", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.cardBorder },
                    headingRule: { type: ControlType.Color, title: "Heading rule", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.headingRule },
                    inputBackground: { type: ControlType.Color, title: "Input surface", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.inputBackground },
                    text: { type: ControlType.Color, title: "Text", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.text },
                    mutedText: { type: ControlType.Color, title: "Muted text", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.mutedText },
                    border: { type: ControlType.Color, title: "Input border", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.border },
                    borderHover: { type: ControlType.Color, title: "Border hover", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.borderHover },
                    focus: { type: ControlType.Color, title: "Focus ring", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.focus },
                    accent: { type: ControlType.Color, title: "Accent", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.accent },
                    accentHover: { type: ControlType.Color, title: "Accent hover", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.accentHover },
                    accentActive: { type: ControlType.Color, title: "Accent active", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.accentActive },
                    buttonText: { type: ControlType.Color, title: "Button text", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.buttonText },
                    error: { type: ControlType.Color, title: "Error", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.error },
                    errorBackground: { type: ControlType.Color, title: "Error surface", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.errorBackground },
                    formErrorBackground: { type: ControlType.Color, title: "Form error surface", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.formErrorBackground },
                    success: { type: ControlType.Color, title: "Success", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.success },
                    successBackground: { type: ControlType.Color, title: "Success surface", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.successBackground },
                    successBorder: { type: ControlType.Color, title: "Success border", defaultValue: GM_FORM_DESIGN_DEFAULTS.colors.successBorder },
                },
            },
            typography: {
                type: ControlType.Object,
                title: "Typography",
                controls: {
                    bodyFontFamily: { type: ControlType.String, title: "Body font", defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.bodyFontFamily },
                    headingFontFamily: { type: ControlType.String, title: "Heading font", defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.headingFontFamily },
                    bodySize: { type: ControlType.Number, title: "Body size", min: 12, max: 24, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.bodySize },
                    labelSize: { type: ControlType.Number, title: "Label size", min: 11, max: 20, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.labelSize },
                    helperSize: { type: ControlType.Number, title: "Helper/error size", min: 10, max: 18, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.helperSize },
                    headingSize: { type: ControlType.Number, title: "Heading size", min: 18, max: 48, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.headingSize },
                    headingWeight: { type: ControlType.Number, title: "Heading weight", min: 400, max: 900, step: 100, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.headingWeight },
                    bodyLineHeight: { type: ControlType.Number, title: "Body line height", min: 1, max: 2, step: 0.05, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.bodyLineHeight },
                    headingLineHeight: { type: ControlType.Number, title: "Heading line height", min: 1, max: 2, step: 0.05, defaultValue: GM_FORM_DESIGN_DEFAULTS.typography.headingLineHeight },
                },
            },
            layout: {
                type: ControlType.Object,
                title: "Layout",
                controls: {
                    maxWidth: { type: ControlType.Number, title: "Max width", min: 280, max: 900, step: 4, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.maxWidth },
                    cardRadius: { type: ControlType.Number, title: "Card radius", min: 0, max: 40, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.cardRadius },
                    cardPaddingTop: { type: ControlType.Number, title: "Card padding top", min: 0, max: 80, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.cardPaddingTop },
                    cardPaddingRight: { type: ControlType.Number, title: "Card padding right", min: 0, max: 80, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.cardPaddingRight },
                    cardPaddingBottom: { type: ControlType.Number, title: "Card padding bottom", min: 0, max: 80, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.cardPaddingBottom },
                    cardPaddingLeft: { type: ControlType.Number, title: "Card padding left", min: 0, max: 80, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.cardPaddingLeft },
                    formGap: { type: ControlType.Number, title: "Form gap", min: 4, max: 40, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.formGap },
                    fieldGap: { type: ControlType.Number, title: "Label gap", min: 0, max: 20, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.fieldGap },
                    nameGap: { type: ControlType.Number, title: "Name column gap", min: 4, max: 40, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.nameGap },
                    textareaMinHeight: { type: ControlType.Number, title: "Description height", min: 80, max: 360, step: 10, defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.textareaMinHeight },
                    headingAlign: { type: ControlType.Enum, title: "Heading align", options: ["left", "center", "right"], optionTitles: ["Left", "Center", "Right"], defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.headingAlign },
                    buttonAlign: { type: ControlType.Enum, title: "Button align", options: ["left", "center", "right"], optionTitles: ["Left", "Center", "Right"], defaultValue: GM_FORM_DESIGN_DEFAULTS.layout.buttonAlign },
                },
            },
            controls: {
                type: ControlType.Object,
                title: "Inputs",
                controls: {
                    height: { type: ControlType.Number, title: "Input height", min: 36, max: 72, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.controls.height },
                    radius: { type: ControlType.Number, title: "Input radius", min: 0, max: 30, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.controls.radius },
                    padding: { type: ControlType.Number, title: "Input padding", min: 4, max: 28, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.controls.padding },
                },
            },
            button: {
                type: ControlType.Object,
                title: "Button",
                controls: {
                    minWidth: { type: ControlType.Number, title: "Minimum width", min: 100, max: 400, step: 4, defaultValue: GM_FORM_DESIGN_DEFAULTS.button.minWidth },
                    height: { type: ControlType.Number, title: "Minimum height", min: 36, max: 72, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.button.height },
                    radius: { type: ControlType.Number, title: "Radius", min: 0, max: 40, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.button.radius },
                    horizontalPadding: { type: ControlType.Number, title: "Horizontal padding", min: 8, max: 48, step: 2, defaultValue: GM_FORM_DESIGN_DEFAULTS.button.horizontalPadding },
                    fontSize: { type: ControlType.Number, title: "Text size", min: 12, max: 24, step: 1, defaultValue: GM_FORM_DESIGN_DEFAULTS.button.fontSize },
                    fontWeight: { type: ControlType.Number, title: "Text weight", min: 400, max: 900, step: 100, defaultValue: GM_FORM_DESIGN_DEFAULTS.button.fontWeight },
                },
            },
        },
    },
})
