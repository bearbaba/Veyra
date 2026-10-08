# Veyra Phase 1 — Storage Foundation
# Schema, Indexes, Constraints and Migration Plan
# Status: APPROVED — implementation in progress
# Date: 2026-10-08
# Amendment: 8 additional requirements incorporated (see section below)

---

## Applied Amendments (2026-10-08)

All 8 requirements incorporated before implementation began:

| # | Requirement                                               | Implementation                                                                          |
|---|-----------------------------------------------------------|-----------------------------------------------------------------------------------------|
| 1 | Handle case-insensitive + Unicode/confusable defense      | `LOWER(veyr_handle)` unique index; `normalizeHandle()` strips Unicode confusables at service layer; `pg_trgm` similarity check before claim |
| 2 | X handles are display aliases; xAccountId is canonical    | `external_id` (immutable) is the binding key; `external_handle` is nullable refresh-only metadata |
| 3 | identity_revision increments must be concurrency-safe     | Postgres trigger uses `UPDATE ... SET identity_revision = identity_revision + 1` (atomic); no application-layer read-modify-write |
| 4 | Include environment in dedup_key                          | `environment` (e.g. `'testnet'`, `'mainnet'`) added as 9th axis to `dedup_key` SHA-256 hash |
| 5 | clientIntentId must be cryptographically unique           | Server issues `clientIntentId` via `crypto.randomUUID()` on POST /api/intents; timestamp-derived IDs rejected |
| 6 | Block overrides follow, friendship, recipient discovery   | `checkBlocked(blocker, blocked)` called at top of every resolver, follow, connection, and payment query |
| 7 | Wallet/identity removals are revocations, not deletes     | `status = 'REVOKED'`, `revoked_at = NOW()` — no DELETE on wallet_bindings or linked_identities ever |
| 8 | Audit/execution event tables are append-only by enforcement | Postgres RLS + trigger blocks UPDATE/DELETE on `execution_events` and `identity_revisions`; BFF uses INSERT-only repository methods |

---

## Database conventions

| Convention                    | Rule                                                           |
|-------------------------------|----------------------------------------------------------------|
| Primary keys                  | `TEXT` with application-generated prefixed IDs (see below)    |
| Foreign keys                  | Always reference `veyra_users.veyr_user_id`; never handle/xId |
| Timestamps                    | `TIMESTAMPTZ NOT NULL DEFAULT NOW()`                          |
| Soft delete                   | `deleted_at TIMESTAMPTZ` — NULL means active                  |
| Append-only tables            | No `UPDATE` or `DELETE` permitted: enforced by trigger + RLS  |
| Enum types                    | Postgres `ENUM` for closed sets; `TEXT` for extensible sets   |
| JSON columns                  | `JSONB` for structured extensible blobs; always indexed       |
| Migrations                    | Drizzle-managed; sequential; never edited after merge          |
| Handle normalization          | Lowercase, max 30 chars, `[a-z0-9_]` only, Unicode stripped   |
| Environment column            | `environment TEXT NOT NULL DEFAULT 'testnet'` on dedup tables |

### ID formats

| Entity            | Prefix  | Example                              |
|-------------------|---------|--------------------------------------|
| Veyra user        | `usr_`  | `usr_8f31kQmzN4rPxVwBcD7hJY2sTgL9Ae` |
| Wallet binding    | `wlt_`  | `wlt_9Kp2mRnXqT7sUvBzE4cAf1dLhJ6Yw0` |
| Linked identity   | `lid_`  | `lid_3Gn5oQrYeM8wHkCxP2bZu7tFaI0Vs1` |
| Identity snapshot | `snp_`  | `snp_...`                            |
| Receive pref      | `rcp_`  | `rcp_...`                            |
| Follow edge       | `flw_`  | `flw_...`                            |
| Connection        | `con_`  | `con_...`                            |
| Block             | `blk_`  | `blk_...`                            |
| Activity receipt  | `rec_`  | `rec_...`                            |
| Execution event   | `evt_`  | `evt_...`                            |
| Identity revision | `rev_`  | `rev_...`                            |
| Post              | `pst_`  | `pst_...`                            |
| Post interaction  | `pin_`  | `pin_...`                            |
| Post tip          | `ptp_`  | `ptp_...`                            |
| Handle history    | `hdl_`  | `hdl_...`                            |
| Route quote       | `quo_`  | `quo_...`                            |
| Intent            | `int_`  | `int_...`                            |

---

## Migration files (Drizzle)

```
server/db/migrations/
  0001_create_enums.sql
  0002_create_veyra_users.sql
  0003_create_handle_history.sql
  0004_create_linked_identities.sql
  0005_create_wallet_bindings.sql
  0006_create_identity_snapshots.sql
  0007_create_receive_preferences.sql
  0008_create_social_follows.sql
  0009_create_social_connections.sql
  0010_create_social_blocks.sql
  0011_create_activity_receipts.sql
  0012_create_execution_events.sql
  0013_create_identity_revisions.sql
  0014_create_route_quotes.sql
  0015_create_intents.sql
  0016_create_posts_schema_forward.sql
  0017_create_indexes.sql
  0018_create_functions_triggers.sql
```

Drizzle schema source: `server/db/schema/` (one file per group).
Migration journal: `server/db/migrations/meta/_journal.json` (Drizzle-managed, do not edit).

---

## dedup_key construction (9 axes, environment included)

```typescript
// Amendment 4: environment is the 9th axis.
// Amendment 5: clientIntentId is server-issued crypto.randomUUID(), never timestamp-derived.
function buildDedupKey(params: {
  environment:         string;   // 'testnet' | 'mainnet'
  senderAddress:       string;   // lowercase hex
  recipientSnapshotId: string;   // immutable snp_ ID
  amountRaw:           string;   // bigint as decimal string
  assetId:             string;   // e.g. 'usdc'
  sourceChainId:       number;
  destinationChainId:  number;
  providerId:          string;
  clientIntentId:      string;   // server-issued crypto.randomUUID()
}): string {
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
```

---

## Append-only enforcement (Amendment 8)

`execution_events` and `identity_revisions` are enforced append-only at two levels:

1. **Postgres trigger** (`deny_mutation_on_append_only`): fires BEFORE UPDATE or DELETE,
   raises an exception. Applied to both tables.
2. **Repository layer**: `ExecutionEventRepository` and `IdentityRevisionRepository` expose
   only `insert()` — no `update()` or `delete()` methods exist.

```sql
CREATE OR REPLACE FUNCTION deny_mutation_on_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: UPDATE and DELETE are not permitted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_execution_events_append_only
  BEFORE UPDATE OR DELETE ON execution_events
  FOR EACH ROW EXECUTE FUNCTION deny_mutation_on_append_only();

CREATE TRIGGER trg_identity_revisions_append_only
  BEFORE UPDATE OR DELETE ON identity_revisions
  FOR EACH ROW EXECUTE FUNCTION deny_mutation_on_append_only();
```

---

## Revision reconciliation (revision-based, not "BFF wins")

```
if (server.revision > client.revision)  → server wins entirely
if (client.revision > server.revision)  → client wins (offline write)
if (revision equal):
  status:         take the higher enum value (COMPLETE > CONFIRMING > BROADCAST > ...)
  bridge fields:  server wins if non-null; client wins if server null
  resumePayload:  server wins if present; client wins if server absent
  events:         union by event_id (immutable, no conflict possible)
```

---

## Phase 1 acceptance criteria

Phase 1 is complete when ALL of the following pass:

1. All 18 migration files run cleanly on a fresh Postgres 16+ instance via `drizzle-kit migrate`.
2. `ProfileService.createUser` inserts a `veyra_users` row, claims a `handle_history` entry, and writes `identity_revision = 1`.
3. A `wallet_bindings` INSERT triggers a concurrency-safe `identity_revision` increment on `veyra_users` (verified by concurrent transaction test).
4. A `wallet_bindings` status → `REVOKED` triggers `identity_revision` increment; `revoked_at` is set; no row is deleted.
5. `identity_revisions` receives one append-only row per trigger; UPDATE/DELETE on it raises an exception.
6. `execution_events` UPDATE/DELETE raises an exception.
7. `handle_history` reservation window prevents a second user claiming a recently released handle.
8. `social_blocks` index returns current block state; block overrides follow/connection resolution.
9. `activity_receipts.dedup_key` unique constraint rejects a duplicate with the same 9-axis hash.
10. Posts tables exist with correct schema; zero application code references them (grep enforced).
11. A complete rollback of all 18 migrations leaves the DB in the pre-Phase-1 state.
12. Unicode confusable handles are rejected at service layer (test with Cyrillic/Greek lookalikes).
13. `clientIntentId` server-issuance: BFF generates via `crypto.randomUUID()`; client-supplied IDs that don't pass UUID-v4 format are rejected with 400.
14. All 256 existing tests still pass; new Phase 1 tests (target: ≥30 additional) pass.
15. tsc 0 errors, oxlint 0 errors, production build clean.
