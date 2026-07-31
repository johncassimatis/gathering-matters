# Submission File Attachments — Design & Runbook

Lets a public submitter optionally attach one or more files to a submission, with
those files available to moderators/editors during review. Files are **private and
staff-only**; they are never exposed publicly and are not carried into published
content automatically.

Status: **implemented except the production R2/Render configuration**, which is
gated on GM creating the Cloudflare R2 bucket + credentials (see
[§8 Deployment](#8-deployment)).

---

## 1. Storage decision — durable object storage (Cloudflare R2)

External object storage is **not technically mandatory, but strongly preferred**
for GM. The current local driver (`./uploads` bind mount, Directus default
`STORAGE_LOCATIONS=local`) is fine for **local development** but unsafe for
production uploads on Render:

- Render's container filesystem is **ephemeral** — wiped on every deploy/restart,
  so uploaded files would disappear.
- A Render **Persistent Disk** would survive deploys and gets daily snapshots, but
  it requires a paid plan, **pins the service to a single instance**, and disables
  zero-downtime deploys. Higher-maintenance than object storage.

**Recommendation: Cloudflare R2** (S3-compatible, no egress fees). Directus ships
the S3 storage driver in its image, so switching backends is **environment-only —
no Dockerfile/image change**. R2/S3/Supabase all use the same S3 driver config, so
the provider can change later by editing env vars.

| Environment | Driver | Notes |
|---|---|---|
| Local dev / tests | `local` (default) | `./uploads` bind mount; disposable |
| Production (Render) | `r2` (S3 driver) | Durable; private bucket; no egress cost |

---

## 2. Data model

A junction table mirroring the existing `content_item_file` pattern (V004):

```
submission  ──<  submission_file  >──  directus_files
```

`gathering-matters-db/migrations/V007_20260725210000__submission_file.sql`:

```sql
CREATE TABLE submission_file (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    submission_id    uuid NOT NULL REFERENCES submission(id)     ON DELETE CASCADE,
    directus_file_id uuid NOT NULL REFERENCES directus_files(id) ON DELETE RESTRICT,
    label            text,
    sort             integer,
    UNIQUE (submission_id, directus_file_id)
);
```

**Why a junction (not columns on `submission`, not a blob):** it matches the
codebase's own convention (`content_item_file`, `submission_tag`), supports
multiple files with ordering/label, renders natively as a Directus m2m interface
for moderators, and leaves the `submission` record's semantics unchanged.
`CASCADE` on the submission side, `RESTRICT` on the file side (a referenced file
can't be orphaned out from under the junction) — identical to `content_item_file`.

---

## 3. Upload flow (`gm-intake`)

One endpoint, `POST /gm-intake/submissions`, dual content-type:

- `application/json` — metadata only (unchanged legacy behaviour).
- `multipart/form-data` — metadata fields + optional `attachments` files.

Order of operations (files stored **last**, so cheap rejections never write to
storage):

1. Parse multipart with streaming caps (busboy): per-file, total, and count limits.
2. Validate metadata (existing rules).
3. **Honeypot → 202**, rate-limit → 429, duplicate → 202 (all before any storage).
4. File guards: oversize/total → 413; too-many → 422.
5. Per-file validation: **extension allowlist + magic-byte sniff** → 422 on mismatch;
   sanitize the download filename.
6. Store each file via a narrow server-side **admin `FilesService`** accountability
   the Submissions folder → collect file ids.
7. Read the actual local/S3 object identity, then transactionally insert `submission`
   + `risk_event` + `submission_file` + immutable-origin `file_scan(PENDING)` rows.
8. On any failure after step 6, `FilesService.deleteOne(...)` each stored file
   (orphan cleanup).

Because uploads are mediated by the server-side service, the **anonymous role never
needs `directus_files` create/read permissions**. Public documents are later served
only by the custom request-time library route after scan and editorial checks.

---

## 4. File restrictions (server-side; frontend validation is advisory only)

Configured via env (`gathering-matters-directus/.env.example`), enforced in
`gm-intake`:

| Limit | Env var | Default |
|---|---|---|
| Max files / submission | `GM_UPLOAD_MAX_FILES` | 5 |
| Max bytes / file | `GM_PUBLIC_UPLOAD_MAX_BYTES` | 15 MB |
| Max bytes / submission | `GM_UPLOAD_MAX_TOTAL_BYTES` | 50 MB |
| Allowed MIME types | built-in validator | PDF, DOCX, PPTX, XLSX, TXT |

- **Allowlist:** PDF, DOCX, PPTX, XLSX, TXT. Images, CSV, archives, legacy/macro Office,
  SVG, HTML, executables, scripts, and video are rejected. CSV is excluded because
  malware scanning does not address formula injection; anonymous images are excluded
  because Directus parses image metadata before the asynchronous scan.
- **Magic-byte sniffing** rejects a renamed file (e.g. `.exe` renamed `.pdf`). DOCX
  is validated as an OOXML zip (`PK` signature + `[Content_Types].xml` + `word/`
  markers) to distinguish it from a plain archive.
- **Filename sanitization**: storage path is always a Directus UUID; the original
  name is sanitized only for `filename_download`.
- Global Directus ceiling `FILES_MAX_UPLOAD_SIZE=10mb` as defence in depth.

### Malware scanning — explicit v1 limitation

**MIME/magic-byte validation is NOT malware scanning.** v1 ships **without AV**.
This is acceptable *because* attachments are: a narrow allowlist, private, and
staff-download-only (never executed, never served to the public). If GM later
considers anonymous uploads high-risk, add a scan step (ClamAV sidecar or a hosted
scan API) — it is the one piece that requires extra infrastructure. Staff should
still treat attachments as untrusted and open them in a sandboxed viewer.

### Audio — deferred

No evidence in the repo/design docs that the Listening Program expects voice/audio
submissions (submissions are modelled purely as text). Audio is therefore **out of
v1**. If GM confirms voice submissions, add `audio/mpeg,audio/mp4,audio/wav` to
`GM_UPLOAD_ALLOWED_MIME` and give audio a larger dedicated size cap (a small
per-category rule in `validateUpload`).

---

## 5. Access & permissions

- **Anonymous / public role:** no change. No `submission` create, **no
  `directus_files` create/read**, no `submission_file` access. Everything mediated
  by `gm-intake`.
- **Moderator/Editor roles:** grant
  - **read** on `submission_file`, and
  - **read** on `directus_files` **scoped to the Submissions folder** — filter
    `{"folder":{"_eq":"<GM_SUBMISSIONS_FOLDER_ID>"}}`, **not** all files.
  This lets Studio show and download attachments via the authenticated
  `/assets/:id` endpoint while blocking access to unrelated files.
- Files are **private by default**; only authenticated staff can reach them.
- **Signed/temporary URLs are not required** for review — Directus asset access is
  permission-gated, and moderators view/download inside Studio. (Signed URLs would
  only be needed to expose files to unauthenticated clients, which v1 does not do.)

Per the repo rule *"keep role setup out of migrations"*, apply these permissions
via Directus Studio/API on each instance, not via a SQL migration.

---

## 6. Promotion / public content

Attachments remain **submission-only**. Promotion (`promote-submission`) is
unchanged: it copies title/body/type/source/tags into a draft `content_item` and
**does not** carry files forward or make anything public.

If a moderator later wants to publish a specific attachment, the safe, opt-in path
is to attach it to the content item via the existing `content_item_file` junction
**after** the mandatory privacy review (`content_item_publish_requires_privacy_review`,
V004). No automatic copying; nothing bypasses the review gate.

---

## 7. Orphaned-file cleanup

Two layers:

1. **In-request cleanup (implemented):** if the linking transaction fails after
   files were stored, the endpoint deletes those files in its catch block.
2. **Crash-safe sweep (follow-up job, documented not yet built):** a process crash
   between upload and DB linking cannot run the catch block, leaving an abandoned
   object. A periodic sweep should delete files that are **in the Submissions
   folder**, **not referenced by any `submission_file` row**, and **older than N
   hours** (age threshold avoids racing an in-flight request). Implement as a
   Directus schedule/hook or an external cron using `FilesService`. Query sketch:

   ```sql
   SELECT f.id
   FROM directus_files f
   LEFT JOIN submission_file sf ON sf.directus_file_id = f.id
   WHERE f.folder = :submissions_folder_id
     AND sf.id IS NULL
     AND f.uploaded_on < now() - interval '6 hours';
   ```

---

## 8. Deployment

Migration + code deploy (no third-party account needed):

1. Apply `V007` with Flyway from `main` (post-bootstrap; guarded to require
   `directus_files`).
2. Deploy the rebuilt `gm-intake` extension (baked image; `busboy` is bundled).
3. Local dev keeps the `local` driver — nothing else required.

Production storage (**requires GM to create the R2 bucket + credentials — not done
here**):

4. Create a **private** Cloudflare R2 bucket (e.g. `gm-directus-media`) and an S3
   API token.
5. Set the `STORAGE_R2_*`, `STORAGE_LOCATIONS=r2`, and `FILES_MAX_UPLOAD_SIZE` env
   vars on Render (see `.env.example`). No image rebuild — the S3 driver is bundled.
6. Create a Directus **Submissions** folder; set `GM_SUBMISSIONS_FOLDER_ID` to its
   UUID; add the folder-scoped moderator permissions (§5).
7. Verify with one authenticated test upload, then confirm the file is **not**
   publicly reachable.

---

## 9. Frontend API contract (for Aaron / Framer)

- **Endpoint:** `POST https://cms.gatheringmatters.com/gm-intake/submissions`
- **Content-Type:** `multipart/form-data` when attaching files; `application/json`
  still works for no-file submissions.
- **Fields:** existing text fields (`source`, `title`, `body`, `submitter_name`,
  `submitter_email`, `submitter_phone`, `submitter_age_range`, `consent_to_review`,
  `consent_to_contact`, `website` honeypot); files under repeated field name
  **`attachments`**.
- **Limits (enforced server-side regardless of client):** ≤ 5 files; ≤ 15 MiB each;
  ≤ 50 MiB total; types **PDF, DOCX, PPTX, XLSX, TXT**. Images, CSV, legacy or
  macro-enabled Office files, archives, scripts, and HTML are rejected.
- **Responses:** `201 { data: { id, status: "pending", attachment_count } }`;
  `202 accepted` (honeypot/duplicate); errors use the Directus envelope
  `{ errors: [{ message, extensions.code }] }` — `400` invalid, `422` validation
  (bad type / too many files), `413` oversize, `429` rate-limited.
- **Upload progress:** single request → use `XMLHttpRequest`/`fetch` upload-progress
  events. Client-side validation is for UX only; the server re-checks everything.

---

## 10. Tests

The real HTTP suite is
`tests/integration/gm-intake.http.test.mjs`, run with `npm run test:integration`; it
verifies the actual route, database rows, all five allowed formats, neutral responses,
multipart caps, client abort, and `GM_TEST_MODE`-guarded rollback faults. The
fixture-driven reviewer, library, promotion, and staff-media suites live beside it.
`tests/cleanup.js` removes test
rows and files in disposable runs.

Multipart files are buffered in memory before validation/storage. Maximum file-buffer
memory is the configured per-file cap (15 MiB); aggregate buffered file memory is the
configured total cap (50 MiB), with at most five accepted files. Busboy can read the
current chunk that crosses a cap, so transient request memory may be slightly above the
configured aggregate by one stream chunk.

Role-specific permission checks are covered by the fixture-driven HTTP suites when
their disposable role/token fixtures are supplied; the base intake fixture does not
pretend to provision production permission policies.

The `gm_test_runner` role needs `SELECT`/`DELETE` on `directus_files` and
`submission_file` for the attachment tests + cleanup; add these grants if missing.
