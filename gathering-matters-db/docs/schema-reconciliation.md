# Schema Reconciliation

This document records verification against the real Flyway migrations and database state.

Do not mark an item complete from prior design documents alone.

| Requirement | Actual migration / database object | Present? | Correct? | Needed action |
|---|---|---:|---:|---|
| Canonical `content_item` table |  |  |  |  |
| Private `submission` table |  |  |  |  |
| `submission.content_item_id` |  |  |  |  |
| Unique promoted-content link |  |  |  |  |
| `content_type` lookup |  |  |  |  |
| Tag dimension mapping |  |  |  |  |
| Stored generated `search_tsv` |  |  |  |  |
| GIN full-text index |  |  |  |  |
| Public feed index |  |  |  |  |
| Typed public feed index |  |  |  |  |
| Existing tag backfill mapping |  |  |  |  |
| `content_placement` migration compatibility |  |  |  |  |
| `risk_event` migration compatibility |  |  |  |  |
| Flyway version ordering |  |  |  |  |