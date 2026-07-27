import React, { useEffect, useRef, useState } from "react"
import { addPropertyControls, ControlType } from "framer"
// ---- inlined from gmFormValidation.ts (self-contained for Framer) ----
export const AGE_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
    { label: "18–24", value: "18_24" },
    { label: "25–34", value: "25_34" },
    { label: "35–44", value: "35_44" },
    { label: "45–54", value: "45_54" },
    { label: "55–64", value: "55_64" },
    { label: "65+", value: "65_plus" },
]
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
// ---- end inlined ----

/**
 * Runtime-only props injected by the form controller when a canvas piece is
 * connected through a ComponentInstance outlet. They are deliberately not
 * exposed as Framer controls: they carry form state and event handlers, not
 * design decisions.
 */
export type GmCanvasPieceRuntime =
    | {
          kind: "heading"
          text: string
      }
    | {
          kind: "field"
          field: GmFieldName
          id: string
          label: string
          placeholder?: string
          autoComplete?: string
          inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
          type: "text" | "email" | "tel" | "textarea" | "age" | "consent"
          value: string | boolean
          error?: string
          describedBy?: string
          inputRef?: React.RefObject<HTMLElement>
          onTextChange?: (value: string) => void
          onTextBlur?: (value: string) => void
          onCheckedChange?: (value: boolean) => void
          onAgeChange?: (value: string) => void
      }
    | {
          kind: "submit"
          submitting: boolean
      }

export interface GmCanvasPieceProps {
    runtime?: GmCanvasPieceRuntime
    previewLabel?: string
    labelOverride?: string
    placeholderOverride?: string
    fieldDesign?: {
        textColor?: string
        mutedColor?: string
        errorColor?: string
        inputBackground?: string
        inputBorder?: string
        inputFocus?: string
        inputRadius?: number
        inputHeight?: number
        inputPadding?: number
        labelSize?: number
        bodySize?: number
        errorSize?: number
    }
    headingDesign?: {
        color?: string
        ruleColor?: string
        fontFamily?: string
        fontSize?: number
        fontWeight?: number
        lineHeight?: number
        textAlign?: "left" | "center" | "right"
        paddingBottom?: number
    }
    buttonDesign?: {
        background?: string
        textColor?: string
        radius?: number
        minWidth?: number
        height?: number
        fontFamily?: string
        fontSize?: number
        fontWeight?: number
    }
}

export interface GmCanvasSlots {
    heading?: React.ReactNode
    firstName?: React.ReactNode
    lastName?: React.ReactNode
    email?: React.ReactNode
    phone?: React.ReactNode
    ageGroup?: React.ReactNode
    title?: React.ReactNode
    description?: React.ReactNode
    consentReview?: React.ReactNode
    consentContact?: React.ReactNode
    submitButton?: React.ReactNode
}

interface PieceDesign {
    textColor: string
    mutedColor: string
    errorColor: string
    inputBackground: string
    inputBorder: string
    inputFocus: string
    inputRadius: number
    inputHeight: number
    inputPadding: number
    labelSize: number
    bodySize: number
    errorSize: number
}

const DEFAULT_PIECE_DESIGN: PieceDesign = {
    textColor: "#243244",
    mutedColor: "#64748B",
    errorColor: "#B42318",
    inputBackground: "#FFFFFF",
    inputBorder: "#CBD5E1",
    inputFocus: "#1D1D7A",
    inputRadius: 8,
    inputHeight: 48,
    inputPadding: 14,
    labelSize: 15,
    bodySize: 16,
    errorSize: 13,
}

function CanvasPieceErrorIcon() {
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
                d="M18.6921 19.8286H2.30614C1.9263 19.8286 1.54646 19.7324 1.2147 19.5545C0.67139 19.2612 0.277126 18.7756 0.0992267 18.1842C-0.0786727 17.5928 -0.0161674 16.9678 0.277126 16.4293L8.46531 1.21164C8.86918 0.461577 9.6481 0 10.4991 0C11.3502 0 12.1291 0.466385 12.533 1.21164L20.7259 16.4293C20.9086 16.7658 21 17.1408 21 17.5255C21 18.1409 20.7596 18.7227 20.3221 19.1554C19.8893 19.593 19.3124 19.8286 18.6921 19.8286ZM2.30614 18.29H18.6969C18.9037 18.29 19.096 18.2082 19.2402 18.064C19.3845 17.9198 19.4662 17.7274 19.4662 17.5207C19.4662 17.3957 19.4326 17.2659 19.3749 17.1553L11.1771 1.94247C10.9799 1.57705 10.6386 1.53859 10.4991 1.53859C10.3597 1.53859 10.0183 1.57705 9.82119 1.94247L1.6282 17.1601C1.53204 17.3428 1.508 17.5495 1.5705 17.7467C1.6282 17.9438 1.53204 17.3428 1.6282 17.1601C1.53204 17.3428 1.508 17.5495 1.5705 17.7467C1.6282 17.9438 1.76283 18.1073 1.94073 18.2034C2.05131 18.2611 2.17632 18.29 2.30614 18.29Z"
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

function CanvasPieceChevronIcon() {
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

function CanvasAgeSelect({ runtime }: { runtime: Extract<GmCanvasPieceRuntime, { kind: "field" }> }) {
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)
    const wrapRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLUListElement>(null)
    const selectedIndex = AGE_OPTIONS.findIndex((o) => o.value === runtime.value)
    const selectedLabel = selectedIndex >= 0 ? AGE_OPTIONS[selectedIndex].label : ""
    const listId = `${runtime.id}-listbox`
    const labelId = `${runtime.id}-label`

    function close(focus = true) {
        setOpen(false)
        setActiveIndex(-1)
        if (focus) (runtime.inputRef?.current as HTMLButtonElement | undefined)?.focus()
    }
    function choose(index: number) {
        const option = AGE_OPTIONS[index]
        if (option) runtime.onAgeChange?.(option.value)
        close()
    }
    function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
        if (!open) {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
                e.preventDefault()
                setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
                setOpen(true)
            }
            return
        }
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setActiveIndex((i) => Math.min(AGE_OPTIONS.length - 1, (i < 0 ? selectedIndex : i) + 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActiveIndex((i) => Math.max(0, (i < 0 ? selectedIndex : i) - 1))
        } else if (e.key === "Home") {
            e.preventDefault()
            setActiveIndex(0)
        } else if (e.key === "End") {
            e.preventDefault()
            setActiveIndex(AGE_OPTIONS.length - 1)
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (activeIndex >= 0) choose(activeIndex)
        } else if (e.key === "Escape") {
            e.preventDefault()
            close()
        } else if (e.key === "Tab") {
            close(false)
        } else if (e.key.length === 1 && /\S/.test(e.key)) {
            const index = AGE_OPTIONS.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
            if (index >= 0) setActiveIndex(index)
        }
    }

    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false)
                setActiveIndex(-1)
            }
        }
        document.addEventListener("pointerdown", onPointerDown)
        return () => document.removeEventListener("pointerdown", onPointerDown)
    }, [open])

    useEffect(() => {
        if (open && activeIndex >= 0) {
            ;(listRef.current?.children[activeIndex] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" })
        }
    }, [open, activeIndex])

    return (
        <div className="gmf-select-wrap" ref={wrapRef} data-open={open ? "true" : "false"}>
            <button
                type="button"
                id={runtime.id}
                ref={runtime.inputRef as React.RefObject<HTMLButtonElement>}
                className="gmf-select-btn"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-labelledby={labelId}
                aria-activedescendant={open && activeIndex >= 0 ? `${runtime.id}-opt-${activeIndex}` : undefined}
                aria-invalid={Boolean(runtime.error)}
                aria-describedby={runtime.describedBy}
                onClick={() => (open ? close() : (setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0), setOpen(true)))}
                onKeyDown={onKeyDown}
            >
                <span className={selectedLabel ? "gmf-select-value" : "gmf-select-placeholder"}>
                    {selectedLabel || runtime.placeholder || "Select an age range"}
                </span>
            </button>
            <CanvasPieceChevronIcon />
            <CanvasPieceErrorIcon />
            {open && (
                <ul className="gmf-listbox" id={listId} role="listbox" ref={listRef} aria-labelledby={labelId}>
                    {AGE_OPTIONS.map((option, index) => (
                        <li
                            key={option.value}
                            id={`${runtime.id}-opt-${index}`}
                            role="option"
                            aria-selected={option.value === runtime.value}
                            className={"gmf-option" + (index === activeIndex ? " is-active" : "") + (option.value === runtime.value ? " is-selected" : "")}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => choose(index)}
                        >
                            <span>{option.label}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function errorMessage(runtime: Extract<GmCanvasPieceRuntime, { kind: "field" }>) {
    return runtime.error ? <p className="gmf-error" id={runtime.describedBy} role="alert">{runtime.error}</p> : null
}

/** A canvas-connectable, state-injected field piece. */
export function GmCanvasField(props: GmCanvasPieceProps) {
    const runtime = props.runtime
    if (!runtime || runtime.kind !== "field") return <div className="gmf-field" aria-hidden="true" />
    const invalid = Boolean(runtime.error)
    const fieldClass = "gmf-field" + (invalid ? " gmf-has-error" : "")
    const piece = { ...DEFAULT_PIECE_DESIGN, ...(props.fieldDesign || {}) }
    const style = {
        "--gmf-text": piece.textColor,
        "--gmf-muted-text": piece.mutedColor,
        "--gmf-error": piece.errorColor,
        "--gmf-input-background": piece.inputBackground,
        "--gmf-border": piece.inputBorder,
        "--gmf-focus": piece.inputFocus,
        "--gmf-control-radius": `${piece.inputRadius}px`,
        "--gmf-control-height": `${piece.inputHeight}px`,
        "--gmf-control-padding": `${piece.inputPadding}px`,
        "--gmf-label-size": `${piece.labelSize}px`,
        "--gmf-body-size": `${piece.bodySize}px`,
        "--gmf-helper-size": `${piece.errorSize}px`,
    } as React.CSSProperties
    const autoComplete = runtime.autoComplete || ({
        firstName: "given-name",
        lastName: "family-name",
        email: "email",
        phone: "tel",
    } as Partial<Record<GmFieldName, string>>)[runtime.field]

    if (runtime.type === "consent") {
        return (
            <div className={fieldClass} style={style}>
                <div className="gmf-checkbox-row">
                    <input
                        id={runtime.id}
                        ref={runtime.inputRef as React.RefObject<HTMLInputElement>}
                        type="checkbox"
                        checked={Boolean(runtime.value)}
                        aria-invalid={invalid}
                        aria-describedby={runtime.describedBy}
                        onChange={(e) => runtime.onCheckedChange?.(e.target.checked)}
                    />
                        <label className="gmf-checkbox-label" htmlFor={runtime.id}>{props.labelOverride || runtime.label}</label>
                </div>
                {errorMessage(runtime)}
            </div>
        )
    }

    return (
        <div className={fieldClass} style={style}>
            <label className="gmf-label" id={`${runtime.id}-label`} htmlFor={runtime.id}>{props.labelOverride || runtime.label}</label>
            <div className={runtime.type === "textarea" ? "gmf-control gmf-control--textarea" : "gmf-control"}>
                {runtime.type === "age" ? (
                    <CanvasAgeSelect runtime={runtime} />
                ) : runtime.type === "textarea" ? (
                    <textarea
                        className="gmf-textarea"
                        id={runtime.id}
                        ref={runtime.inputRef as React.RefObject<HTMLTextAreaElement>}
                        value={String(runtime.value)}
                        aria-invalid={invalid}
                        aria-describedby={runtime.describedBy}
                        onChange={(e) => runtime.onTextChange?.(e.target.value)}
                    />
                ) : (
                    <input
                        className="gmf-input"
                        id={runtime.id}
                        ref={runtime.inputRef as React.RefObject<HTMLInputElement>}
                        type={runtime.type}
                        inputMode={runtime.inputMode || (runtime.type === "email" ? "email" : runtime.type === "tel" ? "tel" : undefined)}
                        autoComplete={autoComplete}
                        value={String(runtime.value)}
                        placeholder={props.placeholderOverride || runtime.placeholder}
                        aria-invalid={invalid}
                        aria-describedby={runtime.describedBy}
                        onChange={(e) => runtime.onTextChange?.(e.target.value)}
                        onBlur={(e) => runtime.onTextBlur?.(e.target.value)}
                    />
                )}
                {runtime.type !== "age" && <CanvasPieceErrorIcon />}
            </div>
            {errorMessage(runtime)}
        </div>
    )
}

;(GmCanvasField as unknown as { __gmCanvasPiece?: string }).__gmCanvasPiece = "field"

/** A canvas-connectable heading piece. The controller owns the real copy. */
export function GmCanvasHeading(props: GmCanvasPieceProps & { text?: string }) {
    const text = props.text || (props.runtime?.kind === "heading" ? props.runtime.text : "Gathering Matters")
    const d = props.headingDesign || {}
    return <h2 className="gmf-heading" style={{ color: d.color, borderBottomColor: d.ruleColor, fontFamily: d.fontFamily, fontSize: d.fontSize, fontWeight: d.fontWeight, lineHeight: d.lineHeight, textAlign: d.textAlign, paddingBottom: d.paddingBottom }}>{text}</h2>
}

;(GmCanvasHeading as unknown as { __gmCanvasPiece?: string }).__gmCanvasPiece = "heading"

/** A canvas-connectable submit button. The enclosing controller owns submit behavior. */
export function GmCanvasSubmitButton(props: GmCanvasPieceProps) {
    const submitting = props.runtime?.kind === "submit" && props.runtime.submitting
    const d = props.buttonDesign || {}
    return <button type="submit" className="gmf-button" disabled={submitting} style={{ background: d.background, color: d.textColor, borderRadius: d.radius, minWidth: d.minWidth, minHeight: d.height, fontFamily: d.fontFamily, fontSize: d.fontSize, fontWeight: d.fontWeight }}>{submitting ? "Submitting…" : "Submit"}</button>
}

;(GmCanvasSubmitButton as unknown as { __gmCanvasPiece?: string }).__gmCanvasPiece = "submit"

/**
 * Named outlet renderer. Unsupported linked frames intentionally fall back to
 * the proven controller renderer rather than silently losing form behavior.
 */
export function GmCanvasOutlet({
    slot,
    runtime,
    fallback,
}: {
    slot?: React.ReactNode
    runtime: GmCanvasPieceRuntime
    fallback: React.ReactNode
}) {
    if (!React.isValidElement(slot)) return <>{fallback}</>
    const marker = (slot.type as { __gmCanvasPiece?: string }).__gmCanvasPiece
    const expected = runtime.kind === "field" ? "field" : runtime.kind
    if (marker !== expected) return <>{fallback}</>
    return React.cloneElement(slot, { runtime } as Partial<GmCanvasPieceProps>)
}

addPropertyControls(GmCanvasHeading, {
    text: { type: ControlType.String, title: "Preview text", defaultValue: "Gathering Matters" },
    headingDesign: {
        type: ControlType.Object,
        title: "Heading style",
        controls: {
            color: { type: ControlType.Color, defaultValue: "#243244" },
            ruleColor: { type: ControlType.Color, defaultValue: "#E0E4E8" },
            fontFamily: { type: ControlType.String, defaultValue: "Inter, system-ui, sans-serif" },
            fontSize: { type: ControlType.Number, min: 18, max: 56, defaultValue: 28 },
            fontWeight: { type: ControlType.Number, min: 400, max: 900, step: 100, defaultValue: 700 },
            lineHeight: { type: ControlType.Number, min: 1, max: 2, step: 0.05, defaultValue: 1.2 },
            textAlign: { type: ControlType.Enum, options: ["left", "center", "right"], defaultValue: "center" },
            paddingBottom: { type: ControlType.Number, min: 0, max: 40, defaultValue: 16 },
        },
    },
})

addPropertyControls(GmCanvasField, {
    previewLabel: { type: ControlType.String, title: "Preview label", defaultValue: "Field label" },
    labelOverride: { type: ControlType.String, title: "Approved label copy", optional: true },
    placeholderOverride: { type: ControlType.String, title: "Placeholder copy", optional: true },
    fieldDesign: {
        type: ControlType.Object,
        title: "Field style",
        controls: {
            textColor: { type: ControlType.Color, defaultValue: "#243244" },
            mutedColor: { type: ControlType.Color, defaultValue: "#64748B" },
            errorColor: { type: ControlType.Color, defaultValue: "#B42318" },
            inputBackground: { type: ControlType.Color, defaultValue: "#FFFFFF" },
            inputBorder: { type: ControlType.Color, defaultValue: "#CBD5E1" },
            inputFocus: { type: ControlType.Color, defaultValue: "#1D1D7A" },
            inputRadius: { type: ControlType.Number, min: 0, max: 30, defaultValue: 8 },
            inputHeight: { type: ControlType.Number, min: 36, max: 72, defaultValue: 48 },
            inputPadding: { type: ControlType.Number, min: 4, max: 28, defaultValue: 14 },
            labelSize: { type: ControlType.Number, min: 11, max: 20, defaultValue: 15 },
            bodySize: { type: ControlType.Number, min: 12, max: 24, defaultValue: 16 },
            errorSize: { type: ControlType.Number, min: 10, max: 18, defaultValue: 13 },
        },
    },
})

addPropertyControls(GmCanvasSubmitButton, {
    buttonDesign: {
        type: ControlType.Object,
        title: "Button style",
        controls: {
            background: { type: ControlType.Color, defaultValue: "#1D1D7A" },
            textColor: { type: ControlType.Color, defaultValue: "#FFFFFF" },
            radius: { type: ControlType.Number, min: 0, max: 40, defaultValue: 8 },
            minWidth: { type: ControlType.Number, min: 100, max: 400, defaultValue: 160 },
            height: { type: ControlType.Number, min: 36, max: 72, defaultValue: 48 },
            fontFamily: { type: ControlType.String, defaultValue: "Inter, system-ui, sans-serif" },
            fontSize: { type: ControlType.Number, min: 12, max: 24, defaultValue: 16 },
            fontWeight: { type: ControlType.Number, min: 400, max: 900, step: 100, defaultValue: 700 },
        },
    },
})
