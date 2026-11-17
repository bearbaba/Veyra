# Veyra M0 — controlled official-domain release (NO public financial signing)
**Source of truth:** pinned reviewed M0 Git SHA from PR #87 → #90 → #91, not the current Draft state.
**Single wallet website:** https://veyra-seven-beta.vercel.app only.
**Workflow:** Veyra ID → People → Settlement → Activity. Exchange, X, Chat and bridge writes are not M0 release dependencies.

## Current NO-GO prerequisites
- Existing Mainnet Render DB: `veyra_mainnet_v1_db` on exact instance `dpg-dbk4ingu01pc7391im20-a`. Never relax the Production DB IP allowlist or change the Testnet DB.
- A real, recent backup is NOT verified merely because the connector lists PostgreSQL as Available.
- No restored isolated database has been verified. Do not set `VEYRA_MAINNET_BACKUP_RESTORABLE=1` without a successful real restore and data check.
- Current Production app and backend should remain untouched until this checklist passes. No automatic wallet signing, no browser wallet on Preview and no automatic retries of unknown transactions.
- A fresh restore resource can incur extra Render charges; provision only within the owner-approved budget.

## One operator dashboard action: provision a genuine isolated restore
In the Render Dashboard, choose the **Mainnet database** and use its supported **Backups/Recovery/PITR** controls to restore a recent snapshot to a *new PostgreSQL 16 instance*.
Record the backup reference, restore completion time, **new instance ID**, its exact internal hostname and database name privately. Never paste connection strings, tokens or wallet secrets in GitHub/ChatGPT.

If the plan has no supported recovery action, use a verified `pg_dump` custom-format backup and `pg_restore` from an authorized private-network operator machine:
```bash
# Run on a trusted host with PostgreSQL 16 client tools and private Render access.
# SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are secret environment variables.
# The restore MUST be on a new, independently identified PostgreSQL instance.
pg_dump --no-owner --no-acl --format=custom --file=m0-before-0021.dump "$SOURCE_DATABASE_URL"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" m0-before-0021.dump
```
Do not assume an export is restorable until `pg_restore` completes and the rehearsal below passes. Do not create a production clone by merely renaming a database inside the Production instance.

## Exact restoration rehearsal — reviewed repository commit
Run in an authorized **internal environment** with source at the exact reviewed M0 SHA and a connection to the restored instance. Never use the Production BFF's `DATABASE_URL` or a public shell for the restore test. Configure the following as private environment values (not command arguments or screenshots):
- `VEYRA_M0_RESTORE_DATABASE_URL`: restored instance's private connection string, **not** the production value.
- `VEYRA_M0_RESTORE_DATABASE_NAME`: actual restored database, different from `veyra_mainnet_v1_db`.
- `VEYRA_M0_RESTORE_HOST`: exact hostname of that new Render instance, never the Mainnet instance.
- `VEYRA_M0_RESTORE_PRIVATE_NETWORK=1` when using genuine private Render networking; otherwise verified TLS.
- `VEYRA_M0_RESTORE_CONFIRM`: must exactly match the restored database name.
- `VEYRA_M0_RESTORE_REHEARSAL_ONLY=1` and `VEYRA_M0_RESTORE_BACKUP_REFERENCE`: real operator restore identifier.

```bash
bun server/db/rehearseMainnetSettlementRestore.ts
```

The runner **fails closed** for Production/Testnet host names, unknown DB names or missing approval. It checks all 21 legacy Drizzle SQL hashes/timestamps before touching the restore, fingerprints every legacy row across identities, wallet bindings, snapshots and old Pay receipts, runs the additive `0021` migration ONLY on the restored DB, rechecks the 22 hashes and canonical schema, and re-fingerprints legacy data. A synthetic receipt DB write/read is wrapped in ROLLBACK, never persisted or shown as an on-chain transfer.

**Recorded evidence required** (without personal records): restored instance ID, backup reference, exact M0 SHA, 21→22 migration result, fingerprint equality, PostgreSQL 16, synthetic DB receipt test, operator attestation and timestamp. A script success on a disposable CI PostgreSQL instance is not proof that the real Render backup can be restored.

## Production promotion gates — only after actual restore success
1. Confirm zero drift in the stacked Git dependency chain PR #87 → #90 → #91; pin the exact reviewed release SHA, run all GitHub release jobs and confirm the old frontend/backend can coexist with the additive 0021 table for a **code-only** rollback.
2. From the controlled Render private environment, verify the Production hostname and hard-coded database target, a recent genuinely restorable backup, backup identity and version approval. Only then run `bun server/db/migrateMainnetPilot.ts` with existing strict `VEYRA_MAINNET_*` approval variables. This is a separate Production change from the restore rehearsal.
3. Deploy that SAME reviewed SHA to the isolated Render Mainnet BFF with Auto Deploy OFF. Verify `/api/health/database`, `/api/identity/mainnet-capability`, and anonymous Settlement receipt endpoints return 401; confirm signing/relay APIs stay denied. Logs must not expose private notes or auth.
4. Stage a **Production-target** Vercel build without assigning the official domain; inspect its exact git SHA, build profile and exact two Settlement receipt API rewrites. This is NOT a wallet test site; do not connect wallets to staging/Preview. Promote the tested build to `veyra-seven-beta.vercel.app` only after routing/read-only backend acceptance. Keep `VITE_VEYRA_CANARY_ONLY=1` and require the owner canary's 0.01 USDC signing ceiling; do not enable general-public signing. Do not promote a Preview build.
5. Verify on the official domain: 5042 authority; login/cookie restore; People resolves a verified B wallet; Activity loads existing receipts. Before any real payment confirm read-only/audit/recovery gates and rollbacks.
6. Only the authorized wallet holder signs a single <=0.01 USDC contract Settlement canary on the official domain. Independently verify original Arc tx hash, two-confirmation onchain event + USDC transfers, backend receipt for A and B, and sender-only private note scope. Reload and check the same receipt on a second device. Pending/UNKNOWN must NEVER trigger a second transfer.
7. Do not unlock public financial signing unless A→B real-money acceptance, mobile reload, second-device auth, privacy and rollback all pass. Logs and tx hash suffice; video is not required.

## Rollback: code and signing gates, NEVER ordinary DB rollback
If promotion fails, freeze new signing first, preserve original transaction journals, roll frontend to the previously verified compatible version and backend to the previous compatible SHA; keep additive receipt schema 0021 and all new data intact. A database snapshot restore is a **disaster recovery procedure only**, not normal rollback after newer transactions. A pre-migration backend must be explicitly tested against the post-migration schema before declaring rollback ready.

**Do not mark M0 released** until production URL, BFF SHA, DB migration count, real owner-only A→B tx and two private receipt readbacks are actually observed.
