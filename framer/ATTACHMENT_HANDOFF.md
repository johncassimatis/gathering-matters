# Framer form attachment wiring - handoff checklist

Repository-controlled frontend wiring for public document attachments is done in
`gmFormValidation.ts` and both form components (allowlist, size limit, file-input UI,
multipart submit, neutral messages, and abort-on-unmount). The Framer publish remains a
**manual, gated** step and is intentionally NOT done here.

Forms: `framer/PreservationProjectForm.tsx` (Listening Program) and
`framer/YoungAdultInitiativeForm.tsx` (Young Adult Initiative).

## Do this when enabling attachments (after the backend is deployed + `GM_PUBLIC_FILE_UPLOADS_ENABLED=true`)

1. **Gate visibility.** Set the existing `enableAttachments` property to `true` only
   after the backend flag is on. It defaults to `false`, so the no-attachment path is
   unchanged until the backend is ready.

2. **Add an optional file input** (import from `./gmFormValidation`):
   - `accept={GM_UPLOAD_ACCEPT}` and `multiple` (cap at `GM_UPLOAD_MAX_FILES`).
   - Label: "Attach a document (optional)". Helper text: `Up to ${GM_UPLOAD_MAX_FILES} files, ${formatBytes(GM_UPLOAD_MAX_BYTES)} each. PDF, Word, PowerPoint, Excel, or plain text.`
   - On change, run `validateAttachmentClient(file)` for each; if it returns a message,
     show it (`MESSAGES.attachmentUnsupported` / `attachmentTooLarge`) and drop that file.
   - `accept` is UX only, NOT a security boundary - the backend re-validates everything.

3. **Submit as multipart when files are attached** (otherwise keep the current JSON path):
   ```ts
   if (files.length) {
     const fd = new FormData()
     // append EXACTLY the same text fields the JSON payload sends (source, body,
     // submitter_*, consent_* as "true"/"false" strings, preferred_follow_up, website)
     Object.entries(payloadFields).forEach(([k, v]) => fd.append(k, String(v)))
     files.forEach((f) => fd.append("attachments", f, f.name))
     response = await fetch(GM_API_URL, { method: "POST", body: fd }) // NO Content-Type header
   } else {
     // existing JSON fetch unchanged
   }
   ```
   Do NOT set a `Content-Type` header for the multipart case - the browser sets the
   boundary. Booleans must be sent as the strings `"true"`/`"false"`.

4. **Success message.** When a file was attached, show `MESSAGES.attachmentPending`
   ("...being checked before review."). Do NOT show a download or preview link, a file
   id, or any "malware"/"virus" wording. A submission with no attachment keeps its
   current confirmation.

5. **Preserve existing behaviour.** Young Adult Initiative contact-consent + follow-up
   fields, validation, and the no-attachment path must be unchanged. The file field is
   additive and optional.

6. **Rebuild the inlined deploy artifacts** (they are generated, do not hand-edit):
   ```bash
   node framer/deploy/build-inlined.mjs
   ```
   This regenerates `framer/deploy/*.inlined.tsx`. Review the diff.

7. **Publishing is separate and gated.** Do NOT run `framer/deploy/deploy.mjs` until the
   backend attachment feature is verified in the deployment environment. Clean documents
   appear only through `/gm-library/downloads/:fileId`; pending/rejected files never
   produce a public link. Publishing Framer is the last step, after the AWS + Directus
   deploy gates pass.

## What the backend expects (contract)
- `POST https://cms.gatheringmatters.com/gm-intake/submissions`, `multipart/form-data`.
- Files under field name `attachments` (repeatable). Documents only: PDF, DOCX, PPTX,
  XLSX, TXT. Limits: 5 files, 15 MB each, 50 MB total (defaults; server-enforced).
- Responses: `201 { data: { id, status: "pending", attachment_count } }`; `202` for
  honeypot/duplicate; errors use the Directus envelope (`422` validation/bad type,
  `413` oversize, `429` rate-limited). The response never returns a file id or storage key.
