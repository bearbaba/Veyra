# Phase 8E — Disposable Render Free Testnet acceptance

**Stage:** infrastructure preparation. Not a Mainnet deployment, product launch, approved security audit, or successful two-wallet E2E.

## Existing isolated resource

The workspace owner approved a **Free** PostgreSQL 16 database in the Render **Builder Dev** workspace:

- Render service name: `veyra-testnet-acceptance-db`
- PostgreSQL database: `veyra_testnet_acceptance_db`
- Region: Singapore
- Database instance ID: `dpg-dbc90lo473hc73fgd850-a`
- Free instance expires on **2026-11-20**. It has no backup or high availability.
- Do not store real user identities, private keys, seeds, account credentials or money-related production records.

The production Vercel deployment is separate and unchanged. A Vercel Preview status of READY proves only a static frontend build, **not** BFF/DB readiness.

## Why this differs from `render.yaml`

The existing Blueprint uses paid database/web plans and a `preDeployCommand`; **do not launch it for Free acceptance**. Render Free Web Services cannot use that pre-deploy feature. This isolated Free procedure instead starts `server/db/freeAcceptanceBootstrap.ts` as the Docker start command. It applies Drizzle journal migrations before starting the BFF, holding a PostgreSQL advisory lock to avoid overlapping bootstrap migrations.

Unlike a general migration utility, the special bootstrap refuses anything except the single named **disposable Testnet acceptance** DB and an explicitly opted-in production-shaped BFF. It refuses relay private keys, active testnet relay, Mainnet and non-private database environments. There is no DROP TABLE/DATABASE.

This startup migration procedure is **only for Free acceptance**. Paid, persistent environments must use an approved one-shot pre-deploy migration job, database backups, maintenance controls and a migration rollback policy.

## Free Render web service configuration

Review the final GitHub CI before proceeding. Use Render's **Web Service** service type with:

| Setting | Value |
| --- | --- |
| Name | `veyra-testnet-acceptance-bff` |
| Plan | `free` |
| Region | `singapore` |
| Runtime | `docker` |
| Repo | `https://github.com/bearbaba/Veyra` |
| Branch | `phase5-production-bridge-flow` |
| Dockerfile | `./Dockerfile.bff` |
| Docker context | `.` |
| Start command override | `bun server/db/freeAcceptanceBootstrap.ts` |
| Auto-deploy | **OFF** until manually approved |

Required **private environment variables**:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `VEYRA_ENV` | `testnet` |
| `VEYRA_HOSTED_BACKEND` | `1` |
| `VEYRA_ACCEPTANCE_BOOTSTRAP` | `1` |
| `VEYRA_DATABASE_PRIVATE_NETWORK` | `1` |
| `VEYRA_SIGNER_BACKEND` | `none` |
| `VEYRA_APP_ORIGIN` | **Exact** reviewed HTTPS Vercel Preview origin, no path/trailing slash |
| `VEYRA_SESSION_SECRET` | Fresh random 32+ character secret, entered **only** in Render secret environment |
| `DATABASE_URL` | Copy **internal** connection URL from the Render Postgres page **directly into Render env settings**, never into ChatGPT, GitHub, screenshots or logs |
| `ARC_TESTNET_RPC_URL` | `https://rpc.testnet.arc.io` |
| `ETH_SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` |

Do not configure `RELAY_PRIVATE_KEY`, `VEYRA_ENABLE_TESTNET_RELAY`, any Mainnet funding account, or a paid API key. Use Render's private database network, not public IP access. `DATABASE_URL` must target `/veyra_testnet_acceptance_db` exactly. Preview URLs with Vercel SSO enabled require user authentication and **are not** proof of an integrated Friends screen.

The connector currently cannot retrieve a fresh database's internal connection string for secure linking. The user must set it in **Render → Web Service → Environment**, not send it in chat.

## Acceptance gates (run in order)

1. Check that migrations run once and journal tables reach Phase 5 schema without errors. Startup **must refuse** missing or wrong DB, missing session secret, any Mainnet, or signing/relay config.
2. `GET /api/health/database` must return 200 with `scope=database-infrastructure-only`, without host/user/secret disclosures.
3. `GET /api/health/readiness` must report infrastructure readiness; RPC providers are public, can rate-limit or fail, and cannot be treated as financial acceptance.
4. Anonymous `GET /api/social/friends` must return **401**; browser requests from unapproved `Origin` must return **403**; approved Preview origin must be exact.
5. Create two disposable Arc Testnet wallets. **Wallet owners themselves** sign registration claims in a controlled browser; verify EIP-712 ownership, stale/replay/wrong-chain rejection, authentication, persistence and reconnect.
6. Confirm Friend request/accept/block/unblock in two browser sessions. Check no stale privacy edges or sessions after reload. No mock header or fake user data is used.
7. Only then prepare a capped, clearly reviewed Pay-by-ID transfer. Do not sign/broadcast or spend funds as an automated acceptance step; it requires explicit human wallet approval and canonical receipt reconciliation.

**Release decision:** No Mainnet financial execution; no Production promotion; Friends/Pay-by-ID UI is not marked live until gates 1–6 pass, and real Testnet payment is separately approved and demonstrated.

Reference: `docs/veyra-phase8a-social-payment-security.md`, PR #28 (authenticated CI test), `docs/veyra-phase8b-testnet-acceptance.md` (not yet merged).
