# Client Engineering Walkthrough — Facilitation Runbook

**Your job today:** lead the engineering walkthrough end-to-end (assume Aaron covers nothing), make it
comprehensible to a **non-technical** audience, and leave real room for "how do I edit this?" questions —
that Q&A is handoff prep. This runbook is the script: what to *say*, what to *click*, and the **front-end
impact** to point at, organized so you can follow it top to bottom.

> **Read the three safety rails first (Section 0).** You're doing a **real, full live publish to prod** — the
> whole chain: Directus publish → Framer plugin "Sync from Directus" → **tag-sync** (attaches the
> Topic/Audience/Region filters) → Framer Publish. tag-sync was **fixed and pushed to main today** (it
> previously would have deleted all content; the dry-run is now clean — see Appendix A6). The one firm habit:
> **always run `npm run sync:framer-tags:dry-run` immediately before `:apply` and confirm the delete count is
> 0/expected** — that preview is the guardrail, on every run. Rehearse the full Appendix A once before the call.

---

## 0. Before the meeting — setup + safety rails (do this 15 min ahead)

**Have these open in tabs, logged in, before anyone joins:**

1. **Directus Studio** — `https://cms.gatheringmatters.com` — logged in as an **Administrator** (you'll switch
   the *narrative* between roles; you don't need to log in as each one).
2. **The Framer project** (editor) — the Gathering Matters project, so you can show the CMS collections and the
   published pages.
3. **The public site** — open whatever the client considers "their website" (confirm the live URL with the team
   first; the site has been through a redesign, so verify what's actually public before you show it).
4. This runbook, on a second screen or printed.

**Three safety rails — internalize these:**

| # | Rail | Why |
|---|---|---|
| A | **Don't casually live-submit the public form.** If you demo it, do one deliberate submission, then delete the resulting row afterward. | The old CORS block is **fixed** (prod `CORS_ORIGIN` now allowlists the Framer site origin), so a submit *will* go through — which means it creates a **real submission** in the Moderator queue and counts against a **5-per-hour rate limit**. Also confirm the form is actually on a live page after the redesign before relying on it. Safest: show the form's *UX* and *describe* the pipeline. |
| B | **You're doing a real, full live publish — rehearse it once before the call and use a _real_ item** (a genuine piece the client wants live = nothing to clean up). Follow **Appendix A** exactly, tag-sync included. | You're on **production** and the public site. Two cautions: (1) **tag-sync is safe now** (fixed + pushed to main today, dry-run 0 deletes, Appendix A6) — but **always `:dry-run` first and confirm 0/expected deletes before `:apply`**, every time. (2) Framer **Publish ships the _whole_ site**, so confirm nothing unintended is staged first. |
| C | **Treat submitter data as sensitive on screen.** When you open the submission queue, avoid lingering on real names/emails/phones — or use a demo submission. | Submissions contain real PII (contact info + consent). Only Moderators/Admins can see it; don't broadcast it on a shared screen. |

**One-line mental model to open with (write it on the board / first slide):**

> **Directus is the back office. Framer is the storefront. A locked, read-only pipe copies only *finished,
> published* work from the back office to the storefront.**

Everything else in this walkthrough is a variation on that sentence.

---

## 1. Opening framing (~3 min) — the mental model

**SAY (plain language):**

> "Gathering Matters runs on two systems that do very different jobs.
>
> - **Framer** is the public website — what visitors see. Think of it as the **storefront window**.
> - **Directus** is the private content system your team logs into — the **back office** where content is
>   written, reviewed for privacy, and approved.
>
> Content is only ever *authored and controlled* in the back office. When something is finished and approved,
> a **one-way, read-only sync** copies it to the website. The website can never write back into your data, and
> the sync only ever carries content that's been **published** — never drafts, never anyone's personal
> information."

**Why this matters to them (say it):** "This split is deliberate. It means the public website physically
*cannot* leak a draft or someone's contact details, because the pipe to the website only has permission to read
finished, published content — and only a short, specific list of fields."

**FRONT-END IMPACT to name up front:** point at the live site and say "every page and card you see here started
as a draft in the back office and had to pass through review and a publish step before it could appear here."

---

## 2. The two-system architecture (~4 min) — one picture

Draw or show this. Keep it to these boxes:

```
   PUBLIC (anyone)                     BACK OFFICE (staff log in)                STOREFRONT (public site)
 ┌──────────────────┐   submit form   ┌───────────────────────────┐   read-only ┌────────────────────┐
 │  2 Framer forms  │ ───────────────▶│         DIRECTUS          │────sync────▶│      FRAMER        │
 │  (Listening,     │   (metadata)    │  content · submissions ·  │   (published │  website + CMS     │
 │   Young Adult)   │                 │  tags · users/roles       │    only)     │  collections       │
 └──────────────────┘                 └───────────────────────────┘             └────────────────────┘
                                              │  Postgres (Neon) = the actual database
                                              │  Schema is code-managed (Flyway migrations)
```

**SAY:**
> "Three lanes. On the left, the **public** can do exactly one thing: submit a form. In the middle, **staff**
> log into Directus to review, edit, and approve. On the right, the **website** reads finished content out.
> Underneath it all is a Postgres database, and the database's *structure* is controlled by version-controlled
> code — not by clicking around — so it's auditable and repeatable."

**Two facts to land (non-technical version):**
- **"The public has exactly one write door."** The only thing an outside visitor can send *into* the system is
  a form submission, through a single narrow endpoint. Everything else is read-only or staff-only.
- **"Roles decide who can do what."** Inside the back office, every staff member has a **role**, and the role
  decides precisely which buttons and fields they even see. That's the heart of today's walkthrough.

---

## 3. Roles — the core of the walkthrough (~15–18 min)

This is a **live, real** configuration on production. There are **six roles**. Frame them as a **relay race
for content**, each with a clear, non-overlapping job — this is "separation of duties," and it's a selling
point for a client handling community stories and personal data.

**SAY (the frame):**
> "We didn't give everyone a master key. Each role can do its own job and *nothing else* — the system enforces
> it, not a policy document. Let me walk you through the relay, in the order content actually moves."

Here's the current live picture to keep in your head (you can share the shape, not the names):

| Role | People on it now | One-sentence job |
|---|---|---|
| **Contributor** | 2 | Young-adult volunteers who *draft their own* content. |
| **Editor** | 1 | Prepares and polishes drafts across contributors. |
| **Moderator** | 1 | Reviews incoming form **submissions** (the only role that sees submitter PII). |
| **Publisher** | 1 | Does the **privacy review** and is the only one who can **publish**. |
| **Administrator** | 2 | Runs the system: users, roles, taxonomy, settings. |
| **Framer Sync** | 1 (a robot) | Read-only service account — the pipe to the website. Not a person. |

> **How to demo "roles are real" in 20 seconds:** In Directus, go to **Settings → Access Policies** (and
> **Settings → Roles**). Show the list. Open one policy — e.g. `content-read-editorial` — and show the plain-English
> **description** and the **field list**. SAY: "This isn't a promise on a wiki. This is the actual switch. If a
> field isn't in this list, that role literally cannot load it — the server refuses."

Now walk each role. For each: **who → can → cannot → what to click → front-end impact.**

### 3.1 Contributor — "draft your own story"
- **Who:** young-adult volunteer contributors (2 today).
- **Can:** create their **own** draft content items (title, summary, body, author, type, link); edit **only their
  own drafts**; read published content + their own drafts.
- **Cannot:** see other people's drafts, editorial notes, submissions/PII, or publish anything. New content is
  **forced to "draft"** automatically — they can't sneak something live.
- **CLICK:** Content → **Content Items**. Explain that a Contributor logging in here would see a much shorter list
  (only published + their own) and a stripped-down editor.
- **FRONT-END IMPACT:** **None yet.** A contributor's draft is invisible to the website by design. SAY: "Writing
  is step one of a relay — nothing a contributor does can reach the site on its own."

### 3.2 Editor — "prepare it for publication"
- **Who:** trusted staff / promoted volunteers (1 today).
- **Can:** read **all** editorial content including everyone's drafts and **editorial notes**; edit content fields
  on **draft and archived** items; **assign existing tags** to content; also create their own drafts.
- **Cannot:** **publish**, set privacy-review fields, manage placements, or touch submissions/PII. They can shape
  content but not flip the "live" switch.
- **CLICK:** open a draft content item; show the **editorial notes** field (Contributors can't see this) and the
  **Tags** chip-picker (add/remove Topic/Audience/Region tags right on the item — see Appendix A1½ / B).
- **FRONT-END IMPACT:** still **none directly** — but the **tags** an editor assigns here become the **filter
  chips** (Topics / Audiences / Regions) on the website once it's published and synced. SAY: "The editor is
  deciding how this will be *findable* on the site later."

### 3.3 Moderator — "triage what the public sends in"
- **Who:** trusted reviewers (1 today). **This is the privacy-sensitive seat.**
- **Can:** read **submissions** from the public forms — including submitter name, email, phone, age range, and the
  **consent records** — and update the review fields (status, reviewer, moderation notes). Can run the **"Promote
  Submission to Content"** action.
- **Cannot:** edit or publish content items, change the submitter's own data/consent, or see audit/admin data.
- **CLICK:** Content → **Submissions**. **(Rail C: use a demo submission or don't linger on real PII.)** Show the
  status field (`pending → approved/rejected`) and the moderation notes. Then show the **"Promote Submission to
  Content"** button on the item page.
- **THE KEY PRIVACY POINT (say it clearly):**
  > "Notice the boundary: the Moderator is the **only** staff role that can see a submitter's personal contact
  > information. When they 'promote' a good submission, the system creates a **content draft that contains the
  > story — but none of the personal contact details**. So the people who later edit and publish never even see
  > the submitter's phone number or email. Privacy is enforced by the role boundary, not by remembering to be
  > careful."
- **FRONT-END IMPACT:** the two public forms on the website **feed this queue**. Point at a form on the site:
  "When someone fills this out, it lands right here as a submission for the Moderator — and nothing about it
  appears publicly."

### 3.4 Publisher — "privacy review + the publish button"
- **Who:** senior staff / client leadership (1 today). **This is the gate to the public.**
- **Can:** everything the Editor can, **plus** the one thing nobody else can: set **status = published**, stamp
  the **privacy-review** fields, set the **published date**, toggle **featured**, and manage **content
  placements**.
- **Cannot:** see submitter PII, audit/risk data, or manage users/roles/system settings. Publishing power is
  deliberately *separated* from user-management power.
- **CLICK:** open a **draft** content item as the demo. Show the **Status** field and the **privacy-reviewed**
  fields and **Featured** toggle. SAY: "Only this role can move Status to Published — and doing so is what records
  that a **privacy review happened**."
- **FRONT-END IMPACT — this is the money moment.** Publishing is the **first** action in the whole relay that can
  actually reach the website. Everything before it was invisible. Tee up Section 4 here: "Let me show you what
  happens the moment a Publisher hits publish."

> **Real numbers to quote (from production right now):** the library holds **31 content items — 9 published,
> 22 archived**. Only those **9 published** items are eligible to reach the website. SAY: "The system is doing
> its job: 22 items exist that the public site cannot see."

### 3.5 Administrator — "runs the building" (admin-specific controls)
- **Who:** you + one other (2 today). Full control. Spend real time here — the client asked about admin controls.
- **Admin-only powers, each with a front-end consequence:**

| Admin control | Where | What it does | Front-end impact |
|---|---|---|---|
| **Users & roles** | User Directory / Settings → Roles | Add staff, assign a role, deactivate someone. | Controls *who* can move content through the relay at all. |
| **Taxonomy (tags & content types)** | Content → Tags / Content Types | **Only admins can create or rename** the tag categories (Topics/Audiences/Regions) and the content types. Editors can only *apply* existing ones. | New tags/types become **new filter categories and tabs** on the website (after sync). Today: **30 tags** (20 regions, 6 audiences, 4 topics) and **7 active content types** (Story, Interview, Research, Report, Resource, Listening Insight, Gathering Practice). |
| **The Framer Sync token** | User Directory → the `Framer Sync` service account → Token | Rotate/revoke the read-only key the website uses. | **Kills or restores the entire pipe to the website.** Revoke it and the site stops receiving updates — a real "off switch." |
| **Project settings & feature flags** | Settings → Project Settings / env (Render) | CORS allowlist, file-upload + virus-scan flags, etc. | Controls whether the **public forms can submit** (CORS — now fixed) and whether **file attachments + malware scanning** run. **These are ON in production:** public uploads, S3 storage, GuardDuty scan-consumer, and scan-gating are all live (staff-upload flag is the one deliberately still off). |
| **Flows** | Settings → Flows | Owns the **"Promote Submission to Content"** automation the Moderator runs. | Defines how a raw submission becomes an editable draft. |

- **CLICK:** Settings → **Access Policies** and **Roles** (show the whole matrix exists); Settings → **Flows**
  (show the one promotion flow); Content → **Tags** (show the three dimensions).
- **CRITICAL admin discipline to state out loud (great handoff/trust point):**
  > "One rule even admins follow: the **database structure** — the tables and fields themselves — is **not**
  > changed by clicking around in here. It's changed only through version-controlled code review (a tool called
  > Flyway). That means every structural change is written down, reviewed, and reversible. An admin manages
  > *content and people*; the *shape of the data* is engineering-controlled. That's what keeps this maintainable
  > after handoff."

### 3.6 Framer Sync — "the read-only pipe" (not a person)
- **Who:** a **service account** (a robot login), not a human.
- **Can:** read **only** published content and only a **10-field allowlist** (id, slug, title, summary, body,
  author, link, featured, published date, type) plus active tags/types.
- **Cannot:** see drafts, editorial notes, submissions, PII, users, or system data — and **cannot write anything,
  anywhere.** Verified: any create/update/delete returns "forbidden."
- **CLICK:** (optional, for the technical-curious) show the `Framer Sync` policy's single **read** permission and
  its published-only filter. SAY: "This is the entire surface the website is allowed to touch. Ten fields,
  published-only, read-only."
- **FRONT-END IMPACT:** this account **is** the bridge. Everything on the storefront came through this
  10-field, published-only, read-only straw. That's the single most reassuring sentence for a client worried
  about a website leaking private data.

---

## 4. The end-to-end lifecycle demo (~8 min) — "watch it reach the website"

This is the centerpiece: show the **relay** moving one item from invisible to live, and back. **Use your
pre-staged `DEMO — safe to delete` draft (Rail B).**

**Narrate the chain (and do the safe subset live):**

1. **A submission arrives** (Moderator's queue) → Moderator reviews, approves, clicks **Promote Submission to
   Content**. → *A new **draft** content item is born — no PII copied.*
2. **Editor prepares it** — fixes wording, assigns **tags**. → *Still a draft. Still invisible to the site.*
3. **Publisher reviews for privacy and publishes** — Status → **Published**, privacy fields stamped. → *Now it's
   eligible for the website — but not there yet.*
4. **Sync content to the website:** in the **Framer plugin**, click **"Sync from Directus."** → *The published
   item now appears in Framer's CMS.*
5. **Attach the filters + reconcile:** run **tag-sync** — `npm run sync:framer-tags:dry-run` (confirm the delete
   count is 0/expected), then `npm run sync:framer-tags`. → *Topic/Audience/Region filter chips get attached, and
   any newly-archived items are removed.*
6. **Publish in Framer.** → **Now it's live on the public site, filters and all.** Point at it.
7. **Retire it:** back in Directus, a Publisher sets Status → **Archived**; the next tag-sync run removes it → *gone
   from the site.* Show that the relay runs backwards too.

**SAY (the takeaway):**
> "Seven deliberate steps, three different people, one automated pipe. Nothing reaches the public by accident,
> and anything can be pulled back by changing one field in the back office. That's the whole system."

> **Safety reminder:** steps 1–3 are internal (safe on the demo draft). For step 5, **run the tag-sync dry-run
> first and read the plan** before applying. For step 6, Framer **Publish ships the whole site** — confirm
> nothing unintended is staged. Use a *real* item so the live result is something the client actually wants.

---

## 4B. External link vs. a page that auto-renders on the site (~4 min)

This is the editorial decision the client will hit constantly, so make it crisp. It comes down to **two fields
on a content item: `slug` and `external_url`.**

**The one hard rule (verified on production):** the sync to the website only carries items that have a **slug**.
No slug → the item never reaches Framer at all — no page, no card, no error. So *anything* you want visible on
the site — a full article **or** just a link — **must have a slug.**

**Pattern 1 — a page that lives on the GM site (auto-rendered).**
- Fill in **slug + body** (plus title, summary, type). Leave `external_url` empty.
- On publish + sync, Framer's **reusable dynamic detail page** renders a real page at that slug, using the
  `body` as the content. *(Verified live: the "Framer Dynamic Article Test" item — slug + body — renders as a
  full page.)*
- **Impact:** the content is **hosted by you**, on your domain — you control it, it matches the site, it's
  linkable and indexable. This is the default for stories, gathering practices, and research write-ups.

**Pattern 2 — a link out to an external source.**
- Fill in **external_url** (the outside address). **Still give it a slug** so the card appears.
- `external_url` is one of the 10 fields that sync to Framer, so the site's card/button can send the visitor
  **off-site** to that source.
- **Impact:** the destination is **not hosted by you** — you don't control that page, it can move or break, and
  it takes the visitor off the GM site. Use it for partner reports, press, or anything already published
  elsewhere.

**SAY (plain language):**
> "Two questions decide it. One: should this be a page on *your* website, or a pointer to someone else's? A page
> → write the body. A pointer → paste the external link. Two: either way, if you want it to show up at all, it
> needs a **slug** — that's its address on the site. No slug, and the website simply never sees it."

> **Gotcha to flag for handoff:** an item with an `external_url` but **no slug** is invisible on the site — it
> won't error, it just won't appear. If someone says "I added the link but it's not showing," check the slug
> first. (Exact fields and example entries for both patterns are in **Appendix A**.)

---

## 5. "How do I edit this?" — Q&A prep (leave ~10 min)

The client will point at the site and ask editing questions. Here's the honest answer pattern and a cheat-sheet.
**The universal answer:** *"You edit it in Directus (the back office), then it syncs to the site — you never edit
the website directly."*

| If they point at… and ask "how do I change this?" | Answer |
|---|---|
| A story's **text, title, or summary** | "Edit the content item in Directus (Editor or Publisher role), then re-sync." |
| Whether a story is **live or hidden** | "That's the **Status** field — a **Publisher** sets Published or Archived. Publishing also records a privacy review." |
| The **filter categories / tags** on the site | "Tags are managed in Directus. **Editors apply** existing tags; **Admins create** new tag categories. Never edit tags in Framer — the sync overwrites them." |
| A **featured** item on the homepage | "The **Featured** toggle on the content item (Publisher), which the site reads." |
| Adding a **link to an external report / off-site source** | "Set the **External URL** field — and keep a **slug** so the card shows and links out. If instead you want it to be a page *on our site*, leave External URL empty and write the **body**. Either way it needs a slug to appear. (See §4B.)" |
| The **submission forms** themselves | "Those are code components — an engineering change, versioned in the repo. Not a click-to-edit CMS field." |
| **Page design / layout / fonts** | "That's **Framer** (the website tool) — that's design, separate from content. Content comes from Directus; look-and-feel is Framer." |
| "Can a volunteer accidentally publish something?" | "No. Contributors can only draft their own work; only a Publisher can make anything live. The system enforces it." |
| "Can the website leak someone's personal info?" | "No — the website's access is read-only, published-only, and limited to 10 non-personal fields. Submitter contact details are visible only to Moderators inside the back office." |

**Encourage them to drive:** "Point at anything on the site and ask me who'd change it and where — that's exactly
the muscle you'll use after handoff."

---

## 6. Honest known-gaps + handoff status (~3 min, if asked)

Don't hide these — framing them as *known, documented, and small* builds more trust than a flawless demo. With
**2 weeks left**, this doubles as the punch-list.

| Item | Plain-language status |
|---|---|
| **File attachments + malware scanning** | **Live in production, verified.** Uploads land in AWS S3, are scanned by Amazon GuardDuty, and only a clean result (`NO_THREATS_FOUND`) is releasable — a real scan resolved cleanly on 2026-08-04. *Nuance to keep straight:* the **backend** is on; whether the **public form** currently offers a file field is a separate front-end item, and **staff-managed uploads** are the one piece still flagged off by choice. |
| **Public form on live pages** | The CORS block is fixed, so submissions work; but the recent Framer redesign may have removed the form from live pages — **confirm the form is actually placed on a public page** before promising it works end-to-end. |
| **tag-sync — fixed & shipped to main today** | The Directus→Framer **tag-sync** job would previously have deleted all content (UUID-vs-slug mismatch); **fixed 2026-08-11** (`main` commit `ce120f7`) to match on the `Directus Id` field + a fraction guard; dry-run now shows **0 deletes** (Appendix A6). It's back to being a normal part of the publish flow — just **`:dry-run` before every `:apply`**. |
| **Delete-to-website** | Archive in Directus, then run tag-sync (dry-run first) — it removes the now-ineligible item from Framer automatically. Then Publish in Framer. |
| **No automated CI yet** | Structure checks and the test suite are run by hand, not automatically on every change. |

**SAY:** "None of these are surprises or silent failures — each one fails loudly or is written down at the exact
spot a maintainer would look. That's the standard we're handing off to."

---

## 7. Timing cheat-sheet (fit it to the meeting)

| Segment | Target | If short on time, cut to… |
|---|---|---|
| 1. Opening mental model | 3 min | the one-sentence model + the two-lanes picture |
| 2. Architecture picture | 4 min | "one public write-door; roles decide the rest" |
| 3. Roles (the core) | 15–18 min | Contributor → Moderator (PII boundary) → Publisher → Admin |
| 4. Lifecycle demo | 8 min | narrate the 6-step relay even if you don't click all of it |
| 4B. External link vs. rendered page | 4 min | "a page → write a body; a link → paste external_url; either way, needs a slug" |
| 5. Q&A "how do I edit this" | 10 min | **protect this — it's handoff prep** |
| 6. Known gaps | 3 min | only if asked, or as a punch-list close |

*Appendix A (below) is a reference, not a timed segment — keep it open on your second screen for the live demo.*

**Golden threads to repeat at least twice each:**
1. *"Back office (Directus) vs. storefront (Framer); a read-only, published-only pipe between them."*
2. *"Every role can do its own job and nothing else — the system enforces it."*
3. *"Submitter personal data is visible to Moderators only, and never travels to the website."*

---

## Appendix A — Exact live-test recipe (Directus, field by field)

Use this to run one safe, real content item through the whole system during the meeting (Rail B). Do it as an
**Administrator** or **Publisher** — only those roles can publish. Pre-stage it before the call if you want the
demo to feel smooth.

### A1. Create the content item
1. Directus Studio → left sidebar **Content** → open the **Content Items** collection.
2. Top-right → **+ Create Item**. You'll see only the fields your role may edit.
3. Type the content. The system auto-fills the rest (id = a fresh UUID, **Status = draft**, source = `gm_upload`,
   Featured = off, metadata = `{}`), so you only fill the fields below.

> **The `Body` field is a plain text box that stores _raw HTML_** — there is no rich-text toolbar, so line
> breaks and structure come from the tags you write, not from pressing Enter. Structure it so the Framer detail
> page renders structure: `<p>` paragraphs, `<h2>`/`<h3>`/`<h4>` headings, `<ul>`/`<ol><li>` lists,
> `<blockquote>`, `<strong>`/`<em>`, `<a href>` links, `<hr>`, even `<table>`. **A flat single sentence renders
> as one flat line** — that's the mistake to avoid. The live item `framer-dynamic-article-test-20260806` is the
> reference for every supported tag. Paste the HTML blocks below into the Body box, not plain prose.

**Example A — a page that renders on the site** (Pattern 1 from §4B):

| Field | Enter |
|---|---|
| **Title** *(required)* | `DEMO — Sunday Story Circle` |
| **Content type** *(required — dropdown)* | **Gathering Practice** |
| **Slug** | `demo-sunday-story-circle`  *(lowercase-hyphen, unique; required to appear on the site)* |
| **Summary** | `A short demo describing a weekly story-sharing gathering.` |
| **Body** *(raw HTML — paste the block below)* | see **Example A `Body`** below the table |
| **Author** | `Demo Author` |
| **External URL** | *(leave empty)* |
| **Featured** | off (or on, to demo a homepage feature) |

**Example A `Body` — paste this into the Body box:**

```html
<p>A simple weekly gathering where a small group shares one short story each — no prep, no performance.</p>
<h2>How it works</h2>
<p>Everyone brings a single memory tied to the week's theme and shares it in a few minutes.</p>
<ul>
  <li>Meet at the same time each week</li>
  <li>One story per person, about five minutes each</li>
  <li>Close with a short shared reflection</li>
</ul>
<blockquote>The point isn't the story — it's the listening.</blockquote>
<h3>What you'll need</h3>
<ol>
  <li>A quiet space that seats six to ten</li>
  <li>A simple prompt for the week</li>
  <li>A volunteer to keep time</li>
</ol>
```

**Example B — an external-source link** (Pattern 2 from §4B):

| Field | Enter |
|---|---|
| **Title** | `DEMO — Partner Research Report` |
| **Content type** | **Research** |
| **Slug** | `demo-partner-research-report`  *(still required, so the card shows)* |
| **Summary** | `A demo entry that links out to an externally hosted report.` |
| **Body** *(raw HTML — paste the block below)* | see **Example B `Body`** below the table |
| **External URL** | `https://example.org/their-report` |
| **Featured** | off |

**Example B `Body` — paste this into the Body box:**

```html
<p>A short summary of a partner-published report; the full document is hosted on their site.</p>
<h2>Why it matters</h2>
<p>The findings reinforce the value of small, consistent gatherings for community wellbeing.</p>
<p><strong>Read the full report</strong> via the external link on this page.</p>
```

4. Click **Save** (the ✓, top-right). It saves as **draft** — invisible to the website.

### A1½. Attach tags — right on the content-item page (the **Tags** field)
The content-item editor has a **Tags** chip-picker (added 2026-08-11). Tagging is a normal on-page field now —
no separate collection:

1. In the item editor, find **Tags** → click it and **search a tag by name** → select it. It appears as a chip.
2. Repeat to add one per dimension; remove a tag by clicking the **✕** on its chip. (Behind the scenes it
   adds/removes `content_item_tag` rows — verified working.)
3. **Save.** For the demo, use this clean set:

   | Dimension | Tag to pick | (slug) |
   |---|---|---|
   | Topic | **Community** | `community` |
   | Audience | **All Ages** | `all-ages` |
   | Region | **Global** | `global` |

> **Content Type** is also a name dropdown now (pick "Story", "Research", etc. — not a UUID). Tags reach the
> public site after **tag-sync** runs (A3 step 2) and you Publish in Framer. Full tag menu: **Appendix B**.
>
> *How this was set up (for maintainers):* the Tags M2M can't be wired through the Studio here — Directus would
> attempt DDL on `content_item_tag`, which `gm_directus` is forbidden from doing (the ownership split). It was
> seeded as owner-level metadata; the reproducible script is
> [`provisioning/07_directus_studio_field_config.sql`](../provisioning/07_directus_studio_field_config.sql)
> (run as owner, then clear the Directus schema cache).

### A2. Publish it (Publisher/Admin only)
1. Open the item → set **Status** → **Published**.
2. Set **Published at** → now (if not auto-set).
3. Stamp the **privacy-reviewed** fields — that's the privacy gate. **Save.**
   *Only a Publisher/Admin can do this step; that's the whole point of the role separation.*

### A3. Push it to the website — the **full live-publish path** (content + tags)
1. **Framer plugin → "Sync from Directus".** The plugin only **creates/updates, never deletes**, so your new
   item appears in Framer's CMS (carrying its `Directus Id`, body HTML, etc.). Do this *before* tag-sync — tags
   attach to an item that already exists in Framer.
2. **tag-sync — dry-run first, then apply** (from the repo root):
   ```bash
   npm run sync:framer-tags:dry-run   # READ the plan — confirm "content items to DELETE: 0" (or expected)
   npm run sync:framer-tags           # apply: attaches Topic/Audience/Region filters, removes ineligible items
   ```
   > 🔒 **The dry-run is the guardrail.** Only run `:apply` after the dry-run shows the delete count is
   > **0 or exactly what you intend**. The fix + fraction guard (A6) make a runaway delete abort, but the habit
   > of reading the plan every time is what keeps prod safe.
3. **Review in Framer, then click Publish.**
   ⚠️ **Framer Publish ships the _whole_ site**, not just your item — before the meeting, confirm the project has
   no unintended staged changes (publish a clean baseline first, so the demo item is the only pending change).
4. **Result:** Example A renders as a page at its slug **with its Topic/Audience/Region filter chips**; Example B
   shows as a card that links off-site.

### A4. Clean up (or just keep it, if it's real)
1. **Best:** publish a *real* item the client actually wants live — then there's nothing to undo, and "we just
   published your content together, live" is a stronger moment than a throwaway.
2. If you used a throwaway: set **Status → Archived** in Directus, then run **`npm run sync:framer-tags`** (dry-run
   first) — the item is now ineligible, so tag-sync **removes it from Framer automatically** — and **Publish**.
   (The plugin itself never deletes; tag-sync is what does removals, and it's safe again.)

### A6. ✅ tag-sync — fixed & shipped to main 2026-08-11 (dry-run every run)
**What was wrong:** `npm run sync:framer-tags` planned to delete **every** live content item, because the Framer
`Directus` collection keys items on the **human slug** (e.g. `exblog1`) while `sync.mjs` matched Directus
eligibility by **UUID** — so nothing matched and all items were flagged for deletion, and the 10-item guard
didn't trip at count 9. Caught by a read-only dry-run during this prep.

**The fix (merged to `main`, commit `ce120f7`):** `sync.mjs` now resolves each Framer item's content_item UUID
from the Framer **`Directus Id`** field (with a UUID-shaped-slug fallback) and only deletes items positively
identified as Directus-managed, so manual Framer records are never touched. A **fraction guard**
(`MAX_DELETE_FRACTION`, default 0.5) was added as a second backstop that aborts a mass delete even under the
absolute cap. `tag-sync/README.md` updated to match. **Verification:** `npm run sync:framer-tags:dry-run` now
reports `content items to DELETE: 0` (was 9); the only remaining plan is non-destructive (it creates the
`Audiences` tag collection + assigns tags on the first run).

**Operating rule going forward:** tag-sync is a normal part of the publish flow (A3 step 2). **Always run
`:dry-run` and read the plan before `:apply`** — confirm the delete count is 0 or exactly what you intend. The
first real `:apply` will create the `Audiences` collection and assign tags; that's expected and non-destructive.

### A5. (Optional) Test the public intake → promote path
Demo the submission side without a browser form by POSTing a demo submission (safe, fake data). It lands in the
**Moderator** queue; the Moderator then approves it and clicks **Promote Submission to Content** to create a
draft content item that re-enters the pipeline above.

```bash
curl -sS -X POST https://cms.gatheringmatters.com/gm-intake/submissions \
  -H "Content-Type: application/json" \
  -d '{"source":"young_adult_initiative","title":"DEMO walkthrough submission","body":"Demo submission created during the client walkthrough to show intake to review.","submitter_name":"Demo Person","submitter_email":"demo+walkthrough@example.com","submitter_age_range":"18_24","consent_to_review":true,"consent_to_contact":true,"consent_to_updates":false,"preferred_follow_up":"email"}'
```

Rules the endpoint enforces (so the demo doesn't fail live): `body` must be **≥20 characters**;
`consent_to_review` must be **true**; young-adult also requires **`consent_to_contact`** and
**`preferred_follow_up`** (`email`|`phone`|`video`); `submitter_age_range` must be `18_24` for young-adult.
The endpoint is **rate-limited to 5/hour per IP** and de-dupes identical submissions for 24h. Delete the demo
submission (and any promoted draft) afterward.

---

## Appendix B — the live tag menu (exact, active tags on production)

Attach these via the `content_item_tag` junction (Appendix A1½). An item can carry one tag per dimension (or
several). **Recommended demo set is bolded.** Slugs are what appear in the Framer `Topics`/`Audiences`/`Regions`
filters after tag-sync.

**Topics (4)** — `topic`
| Tag | slug |
|---|---|
| Belonging | `belonging` |
| **Community** | `community` |
| Health & Well-being | `health-well-being` |
| Trust & Care | `trust-care` |

**Audiences (6)** — `audience`
| Tag | slug |
|---|---|
| Adults | `adults` |
| **All Ages** | `all-ages` |
| Children | `children` |
| Older Adults | `older-adults` |
| Teens | `teens` |
| Young Adults | `young-adult` |

**Regions (20)** — `region`
| Tag | slug | | Tag | slug |
|---|---|---|---|---|
| **Global** | `global` | | Middle East & North Africa | `mena` |
| USA — National | `usa-national` | | Sub-Saharan Africa | `sub-saharan-africa` |
| Northeast USA | `northeast-usa` | | Europe | `europe` |
| Midwest USA | `midwest-usa` | | Central Asia | `central-asia` |
| South USA | `south-usa` | | East Asia | `east-asia` |
| West Coast USA | `west-coast-usa` | | South Asia | `south-asia` |
| Mountain West USA | `mountain-west-usa` | | Southeast Asia | `southeast-asia` |
| Canada | `canada` | | Pacific Islands | `pacific-islands` |
| Mexico & Central America | `mexico-central-america` | | Australia & New Zealand | `australia-new-zealand` |
| Caribbean | `caribbean` | | South America | `south-america` |

> Only **active** tags are shown (there are 30 total). New tag categories can only be created/renamed by an
> **Administrator** (Content → `tag`), and appear on the site as new filter options after the next tag-sync.
