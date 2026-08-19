# Design & documentation index (`gathering-matters-db/docs/`)

Architecture, design, and operational docs for the Gathering Matters backend. Several carry
a dated **status banner** noting what has since shipped — read those first.

| Doc | What it covers |
|---|---|
| [framer-integration.md](framer-integration.md) | Directus → Framer CMS integration architecture (Variant A): the read-only Framer Sync policy, the field allowlist, and the tag/image sync. |
| [framer-phase0-spikes.md](framer-phase0-spikes.md) | Phase 0 feasibility spikes that led to Variant A (why a SQL view could not be exposed as a Directus collection). |
| [s3-scan-gating-design.md](s3-scan-gating-design.md) | S3 + GuardDuty malware scan-gating design and the increment-by-increment implementation record. Deployed and live in production. |
| [submission-attachments.md](submission-attachments.md) | Public submission file-attachment design and runbook (upload contract, scanning, gating). |
| [GM_Backend_Reconciliation_and_Audit.md](GM_Backend_Reconciliation_and_Audit.md) | Reconciliation of the deployed database / Directus state against the intended schema, with an implementation audit. |
| [schema-reconciliation.md](schema-reconciliation.md) | Short schema-reconciliation notes. |
| [client-walkthrough-runbook.md](client-walkthrough-runbook.md) | Internal facilitation runbook for a live engineering walkthrough of the Directus roles and the Framer front end. |
| [walkthrough-presenter-script.md](walkthrough-presenter-script.md) | Internal do-and-say presenter script that accompanies the walkthrough runbook. |
