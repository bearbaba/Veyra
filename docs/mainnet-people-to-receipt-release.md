# Veyra Mainnet V1 — People → Pay → verified two-sided receipt

**One wallet website:** https://veyra-seven-beta.vercel.app/ . Never ask anyone to connect a wallet to a Vercel Preview or another website. Source-level Preview builds are internal.

**Authoritative acceptance and roadmap:** [VEYRA_PRODUCT_STANDARD.md](./VEYRA_PRODUCT_STANDARD.md) v1.1. The sole current milestone is M0: two team-controlled Veyra identities → find a verified recipient **without requiring friendship** → review → controlled USDC send → independently verified two-sided receipt → reopen after login on another device. Each M0 change must meet security, recovery, mobile and performance requirements; X, Chat and Unified are not release dependencies.

## Working in code, not yet Production
- Mainnet browser accepts Veyra ID only when the origin-specific Mainnet BFF reports its real 5042 identity authority. The capability endpoint checks actual PostgreSQL reachability and essential identity/receipt schema. Testnet readiness **cannot** grant Mainnet access.
- Signed, consumed-once EIP-712 login; exact Arc Mainnet wallet binding; HttpOnly restore cookie is chain+origin+wallet scoped. No signing while a non-authorized browser origin is reported.
- People looks up an authenticated 5042 recipient snapshot. Pay refreshes short-lived snapshots before review/signing only if wallet ID, Veyra user ID, handle and recipient address all remain identical. A changed wallet halts payment.
- After the original transfer is verified by the browser, the signed-in sender sends the **same hash** to the BFF. The BFF independently re-fetches canonical RPC transaction, receipt, block and ERC-20 USDC Transfer event; it never signs or retransmits.
- The additive `mainnet_direct_pay_receipts` table has one key per transaction hash on Arc 5042 and stores the canonical block payment time separately from verification time. A caller must be sender or recipient via an active wallet binding. Both users can read the receipt. Only the sender may set or see their private note. A lost/expired ID snapshot suppresses the unverified `@handle` label, **not** the proven transfer.
- Activity reads the owner's backend receipts, de-duplicates local Pay pointers by hash, and keeps other browser-only/provider receipts separate.
- Typecheck, lint, release-profile build and automated CI run on the code. **CI is NOT a substitute for two-wallet Mainnet acceptance.**

## One-month Render pilot — isolated and capped

The user funded only the **Render Hobby + Starter BFF + Basic 256 MB PostgreSQL** pilot.
Both resources exist in Builder Dev / Singapore; neither requires a second user-facing wallet website:
- Mainnet BFF: `srv-dbk4j5nb9u1s73fjrun0` (`veyra-mainnet-v1-bff`), **auto-deploy OFF**.
- Mainnet PostgreSQL: `dpg-dbk4ingu01pc7391im20-a` (`veyra-mainnet-v1-db`), **1 GB Basic**.
- Historical Testnet BFF/database MUST stay isolated and untouched.

**Restricted V1 identity-and-receipts mode**: `Dockerfile.bff.mainnet` starts with
`VEYRA_MAINNET_IDENTITY_ONLY=1`. This mode enforces a server-side exact API allowlist:
EIP-712 wallet sign-in/registration, authenticated Friends, receive preference, Veyra ID payment
verification and canonical signed-owner Pay receipt indexing. Every non-allowlisted
backend action (Agent, StableFX, Gateway, Bridge, X OAuth callbacks, relay signing) returns
`MAINNET_V1_ROUTE_NOT_ENABLED`. The frontend direct transfer still requires an
individual wallet signature and existing P0 safety gates.

Do **not** buy a KMS/HSM signer or X OAuth service for this restricted V1 pilot.
They remain required for the separate *full* financial production backend; removing
those gates from unrestricted Mainnet mode is forbidden.

### Secure configuration in Render (never post secrets into chats or GitHub)

On the **Mainnet BFF** Environment page, configure:
- `DATABASE_URL`: the **Internal Database URL** from the separate Mainnet PostgreSQL
  Connect panel (not the Testnet DB and not a browser `VITE_*` variable).
- `VEYRA_SESSION_SECRET`: newly generated cryptographically random value,
  at least 32 bytes (never recycle Testnet session secrets).
- `VEYRA_DATABASE_PRIVATE_NETWORK=1`: only if using the actual private Render
  DB internal address; otherwise use verified TLS on a nonlocal database URL.
- `ARC_MAINNET_RPC_URL=https://rpc.mainnet.arc.io` (official Arc public RPC;
  verify chainId=5042 at runtime).
- `VEYRA_ENV=mainnet`, `NODE_ENV=production`, `VEYRA_HOSTED_BACKEND=1`,
  `VEYRA_MAINNET_IDENTITY_ONLY=1`, and
  `VEYRA_APP_ORIGIN=https://veyra-seven-beta.vercel.app`.

Leave `RELAY_PRIVATE_KEY`, signer/KMS, Circle API credentials and X OAuth private keys
**unset** in identity-only mode. Never paste these credentials into support threads.

For environments where the hosted connector cannot open a Render shell, a **one-time**
bootstrap can be explicitly selected by setting
`VEYRA_MAINNET_BOOTSTRAP_SCHEMA=1` and
`VEYRA_MAINNET_MIGRATE_CONFIRM=veyra_mainnet_v1_db` in the Render Mainnet BFF
Environment, then manually deploying the reviewed commit. The BFF checks the
**exact new Render Postgres host and name**, uses a Postgres advisory lock,
and runs the recorded migrations **only against an empty database**. A partial,
unexpected, or already populated schema is never overwritten. After successful
migration, set `VEYRA_MAINNET_BOOTSTRAP_SCHEMA=0` and clear
`VEYRA_MAINNET_MIGRATE_CONFIRM`. Never leave a migration trigger enabled
for future releases. Do not send database credentials to ChatGPT or GitHub.

**Only after configuring the internal DATABASE_URL and taking a backup**, use the Mainnet
Render BFF Shell (never a client machine) to run:
```bash
VEYRA_MAINNET_MIGRATE_CONFIRM=veyra_mainnet_v1_db bun server/db/migrateMainnetPilot.ts
```
This script refuses Testnet/localhost, the wrong DB name, missing explicit approval,
non-TLS external PostgreSQL, and non-Mainnet environment settings. It only
applies the registered Drizzle migration journal. Never run the generic
`bun run db:migrate` against an unreviewed Mainnet target.

The BFF must fail closed until all required values are present and the separately
backed-up Mainnet database has passed its registered migrations. Confirm
`POST /api/identity/mainnet-capability` returns authorized `5042` authority through
the official Vercel domain; a simple HTTP 200 from `/api/health` is not sufficient.

**Monthly cost and cancellation:** paid Render resources are recurring until deleted.
Review the pilot by 2026-12-02. No automatic shutdown has been created by this document.

## Operational blocks before release — do NOT bypass

1. **Dedicated, audited Mainnet BFF**: do not route the Mainnet ID, signed sessions or receipt APIs to `veyra-testnet-acceptance-bff.onrender.com`. Provide a selected authorized Render workspace or other approved backend environment. Dedicated database and cryptographic secrets must not be recycled from Testnet; no wallet seed/private key belongs in the frontend.
2. Backend must pass `assertServerRuntimeConfig` under the **restricted identity-only mode** above, with only the official origin, signed-wallet sessions, private Mainnet database, and HTTPS Arc 5042 RPC. KMS/HSM is reserved for the full signer backend, **not** this narrowly scoped no-relay pilot. Never put secrets in `VITE_*` variables.
3. Back up approved Mainnet PostgreSQL, review/apply additive migration `0020_mainnet_direct_pay_receipts.sql` using the registered Drizzle journal, and confirm BFF can read `wallet_bindings`, `veyra_users`, `identity_snapshots` and `mainnet_direct_pay_receipts`. Do not modify or delete Testnet data.
4. Configure the necessary **exact API routes** on the single official Vercel project to the approved Mainnet BFF: `POST /api/identity/mainnet-capability`, wallet-auth + identity prepare/verify routes, `POST /api/mainnet/pay/receipt/verify`, `GET /api/mainnet/pay/receipts` and relevant profile/social routes. Current `vercel.json` proxies many paths to the historical Testnet BFF: **do not flip an identity flag or point Mainnet receipts at that server**.
5. Identity migration/claim policy must preserve one verified person across X, existing Testnet identity and Mainnet where appropriate; never automatically treat a reused handle or unrelated X account as wallet ownership.
6. Two **team-controlled real wallets** A/B, both 5042-bound identities. A signs in, B sets a primary receiver, A looks up verified B **without needing to send or accept a Friend invitation**, reviews exact address, amount and network fees, then uses only the authorized tiny-value canary sender on the official website. The UI explains all necessary confirmations; ordinary direct Pay targets a single wallet transfer authorization, but contract or provider flows may need explicit approvals. After canonical onchain proof the backend indexes one receipt; B sees the **same proof** as a received receipt in their own private session. Logout/reload/another device must still show it. B must not see A's private note; strangers must receive 403 or 401. Wallet rotation/revocation and expired snapshots must not misattribute a name. Explorer-visible chain transactions remain public; only Veyra's private app data is access-controlled.
7. Fault-injection tests: invalid hash/amount/recipient, 1-confirmation pending, RPC timeout, missing receipt, reverted tx, concurrent duplicate indexing, recipient-first indexing, storage failure and ID snapshot expiration. An absent RPC log is **not proof of a failed transfer**, and cannot authorize another send.
8. Compatibility with P0 rollback from PR #87. Old Production `0d3b04f` cannot be used as a signing rollback for unresolved new journals. Keep Bridge writes gated independently. **Do not promote general-public signing** until genuine two-account wallet E2E and compatible rollback pass. Controlled owner-only signing is a distinct restricted exception, not a public feature release.

**Video recording is not a development gate.** For a controlled M0 Mainnet acceptance, allow only an explicitly approved sender wallet, hard 0.01 USDC ceiling, verified receiving wallet, original-hash tracking, emergency read-only switch and documented recovery—after the corresponding deployment is reviewed. That narrowly scoped transaction may be tested before broad release and is **not** proof of general-production readiness. No wallet signatures on Preview domains. General-public financial release requires exact deployment/alias verification, two-account A/B same-receipt acceptance, cross-device restore, privacy checks and compatible rollback. Do not claim completed Mainnet identity, receipt indexing or two-party payment until live evidence verifies each step.
