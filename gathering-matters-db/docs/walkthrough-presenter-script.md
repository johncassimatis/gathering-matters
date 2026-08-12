# Client Walkthrough — Presenter Script (do + say, in order)

Read top to bottom while presenting. **DO** = what to click/navigate. **SAY** = the line to speak.
Detailed rationale, field lists, and safety notes live in the companion `client-walkthrough-runbook.md`.

> **Pre-flight (before anyone joins):** Directus Studio (`cms.gatheringmatters.com`) logged in as **Administrator**;
> the Framer project open; the public site open; a **real** content item drafted and ready to push live (structured
> HTML body — see runbook Appendix A). Have `npm run sync:framer-tags:dry-run` ready in a terminal.

---

## 1 · Opening — the mental model (~3 min)

**DO —** Share your screen. Optionally write on the first slide: *"Directus = back office. Framer = storefront. A read-only, published-only pipe between them."*

**SAY —**
- "Gathering Matters runs on two systems. **Framer** is the public website — the storefront window. **Directus** is the private back office where content is written, privacy-reviewed, and approved."
- "Content is only ever authored and controlled in the back office. When it's finished and approved, a **one-way, read-only sync** copies it to the website. The website can never write back, and only ever carries **published** content — never drafts, never personal info."
- "This split is deliberate: the public site physically *cannot* leak a draft or someone's contact details, because the pipe can only read finished, published content — and only a short list of fields."

**DO —** Point at the live public site.
**SAY —** "Every page and card here started as a draft in the back office and had to pass review and a publish step to appear."

---

## 2 · Architecture — three lanes (~4 min)

**DO —** Show the three-lane picture (public → Directus → Framer; Postgres underneath).

**SAY —**
- "Three lanes. The **public** can do exactly one thing — submit a form. **Staff** log into Directus to review, edit, and approve. The **website** reads finished content out. Underneath is a Postgres database whose *structure* is controlled by version-controlled code, not by clicking — auditable and repeatable."
- "The public has **exactly one write door** — a form submission through one narrow endpoint. Everything else is read-only or staff-only."
- "**Roles decide who can do what** — every staff member has a role that decides which buttons and fields they even see. That's the heart of today."

---

## 3 · Roles — the core (~15–18 min)

**DO —** Settings → **Access Policies**, then **Roles**. Show the list. Open one policy (e.g. `content-read-editorial`) and show its plain-English **description** and its **field list**.

**SAY —**
- "We didn't give everyone a master key. Each role does its own job and *nothing else* — the system enforces it, not a policy document. Here's the relay, in the order content moves."
- "This isn't a promise on a wiki — it's the actual switch. If a field isn't in this list, the role literally cannot load it; the server refuses."

### 3.1 · Contributor
**DO —** Content → **Content Items**. Explain a Contributor sees a much shorter list (only published + their own) and a stripped-down editor.
**SAY —** "Writing is step one of a relay — nothing a contributor does can reach the site on its own."

### 3.2 · Editor
**DO —** Open a draft item; show the **editorial notes** field (Contributors can't see this) and the **Tags** chip-picker (Topic/Audience/Region).
**SAY —** "The editor is deciding how this will be *findable* on the site later — the tags they add here become the site's filter chips."

### 3.3 · Moderator  *(privacy-sensitive — use a demo submission, don't linger on real PII)*
**DO —** Content → **Submissions**. Show the status field (`pending → approved/rejected`) and moderation notes. Show the **"Promote Submission to Content"** button on the item page.
**SAY —**
- "The Moderator is the **only** staff role that can see a submitter's personal contact info. When they 'promote' a good submission, the system creates a content draft with the story but **none** of the contact details — so the people who later edit and publish never see the phone number or email. Privacy is enforced by the role boundary, not by remembering to be careful."
- (Point at a form on the site) "When someone fills this out, it lands right here as a submission for the Moderator — and nothing about it appears publicly."

### 3.4 · Publisher  *(the gate to the public)*
**DO —** Open a **draft** item. Show the **Status** field, the **privacy-reviewed** fields, and the **Featured** toggle.
**SAY —**
- "Only this role can move Status to **Published** — and doing that is what records that a **privacy review** happened."
- "Publishing is the **first** action in the whole relay that can actually reach the website — everything before it was invisible. Let me show you what happens the moment a Publisher hits publish."
- (Quote real numbers) "The library has 9 published, 22 archived items. The system is doing its job: **22 items exist that the public site cannot see.**"

### 3.5 · Administrator  *(spend real time here — they asked about admin controls)*
**DO —** Settings → **Access Policies** and **Roles** (the whole matrix exists); Settings → **Flows** (the one promotion flow); Content → **Tags** (the three dimensions).
**SAY — walk the admin-only powers and their front-end effect:**
- **Users & roles** — "Add staff, assign a role, deactivate someone — this controls *who* can move content through the relay at all."
- **Taxonomy** — "Only admins can create or rename the tag categories and content types; editors can only *apply* existing ones. New ones become new filter categories on the site. Today: 30 tags and 7 active content types."
- **The Framer Sync token** — "This is the read-only key the website uses. Revoke it and the site stops receiving updates — a real off switch."
- **Feature flags / settings** — "These control whether the public forms can submit and whether file uploads + malware scanning run. Those are **on in production** today."
- **Flows** — "This owns the 'Promote Submission to Content' automation the Moderator runs."
- **The discipline line (great handoff/trust point):** "Even admins follow one rule: the **database structure** — the tables and fields — is not changed by clicking around. It's changed only through version-controlled code review (Flyway). Every structural change is written down, reviewed, reversible. Admins manage *content and people*; the *shape of the data* is engineering-controlled. That's what keeps this maintainable after handoff."

### 3.6 · Framer Sync  *(the read-only pipe — a robot, not a person)*
**DO —** (Optional, for the technical-curious) show the `Framer Sync` policy's single **read** permission and its published-only filter.
**SAY —** "This account *is* the bridge. This is the entire surface the website is allowed to touch: **ten fields, published-only, read-only.** It cannot write anything, anywhere."

---

## 4 · Live publish — watch a real item reach the site (~8–10 min)

> This is a **real** publish to production. Use the pre-staged real item. Narrate the relay as you go.

**Step 1 — Create/confirm the draft (Contributor/Editor's job).**
- **DO —** Content → Content Items → open your staged draft (or **+ Create Item** and paste the structured-HTML body). Show it's **Status: draft**.
- **SAY —** "Right now this is a draft. It exists in the back office and the website cannot see it."

**Step 2 — Prepare + tag (Editor's job).**
- **DO —** Tidy the wording. Then use the **Tags** field right on the item: click it, search a tag by name, select
  it (chip appears); add **Community** (topic), **All Ages** (audience), **Global** (region). Save. (Full menu:
  runbook Appendix B.)
- **SAY —** "The editor shapes it and decides how it'll be found — I just tag it Community, All Ages, Global right
  here, and those become the filter chips on the site. Still a draft, still invisible until it's published."

**Step 3 — Privacy review + publish (Publisher's job).**
- **DO —** Set **Status → Published**, set **Published at**, stamp the **privacy-reviewed** fields, **Save**.
- **SAY —** "Only a Publisher can do this, and doing it records that a privacy review happened. Now it's *eligible* for the website — but it's not there yet."

**Step 4 — Sync content to Framer.**
- **DO —** Framer → the Directus plugin → **"Sync from Directus."**
- **SAY —** "This copies the published item into the website's CMS. The plugin only ever reads and creates — it never deletes."

**Step 5 — Attach the filters (tag-sync).**
- **DO —** In the terminal: `npm run sync:framer-tags:dry-run` — read the plan, confirm **"content items to DELETE: 0"** — then `npm run sync:framer-tags`.
- **SAY —** "This attaches the Topic / Audience / Region filter chips. I always preview first and confirm it's not deleting anything — that preview is the safety check."

**Step 6 — Publish in Framer.**
- **DO —** Confirm nothing unintended is staged, then click **Publish** in Framer.
- **SAY —** "And now it's live." (Point at the item on the public site — page + filter chips.)

**Step 7 — Retire it (the relay runs backwards).**
- **DO —** Back in Directus, set **Status → Archived**; re-run `npm run sync:framer-tags`.
- **SAY —** "Change one field in the back office and it comes right back off the site."

**Takeaway SAY —** "Seven deliberate steps, three different people, one automated pipe. Nothing reaches the public by accident, and anything can be pulled back by changing one field in the back office."

---

## 4B · External link vs. a page (~3 min)

**DO —** (Optional) show an item with an **External URL** set, and one without.
**SAY —** "Two questions decide it. One: a page on *your* website, or a pointer to someone else's? A page → write the body. A pointer → paste the external link. Two: either way it needs a **slug** — that's its address on the site. No slug, and the website never sees it."

---

## 5 · Q&A — "how do I edit this?" (protect ~10 min)

**DO —** Hand them the wheel. Invite them to point at anything on the site.
**SAY —**
- "Point at anything on the site and ask me who'd change it and where — that's exactly the muscle you'll use after handoff."
- Universal answer to keep returning to: "You edit it in Directus, then it syncs to the site — you never edit the website directly."

---

## 6 · Known gaps — only if asked (~3 min)

**SAY —** "None of these are surprises or silent failures — each one fails loudly or is written down at the exact spot a maintainer would look. That's the standard we're handing off to."

---

## Close · Golden threads (repeat each at least twice across the session)

1. "Back office (Directus) vs. storefront (Framer); a read-only, published-only pipe between them."
2. "Every role can do its own job and nothing else — the system enforces it."
3. "Submitter personal data is visible to Moderators only, and never travels to the website."
