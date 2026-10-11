# Veyra — full Testnet release and YouTube submission gates

**Status:** IN PROGRESS — not approved for full user release or final recording.
**Repository branch:** `phase5-production-bridge-flow` / PR #7.
**User agreement:** do NOT hand off repeated UI Preview builds for manual trials.
Finish development, developer-operated automated/integration verification,
real wallet-signed testnet acceptance and a finished release before requesting
the user to use the app and record/upload the final YouTube demonstration.

The goal is a functioning **testnet** app, not a static product walkthrough.
Mainnet is a separate release and is **not** an acceptance requirement for
this testnet deliverable.

## Definition of done

| Area | Minimum acceptance evidence | Current blocker |
|---|---|---|
| Build/repository | exact release SHA passes typecheck, lint, PostgreSQL tests, frontend + BFF container builds and bundle checks | Pending final tagged release |
| Hosted frontend | HTTPS Vercel deployment built from the final full-stack release, no scripted/mocked money or AI claims; browser console and routing clean | Current Vercel output remains limited testnet beta preview |
| Backend + database | Hosted Express BFF under HTTPS, PostgreSQL schema migrated to latest, readiness probes healthy, origin/session rules enforced | Managed DB and externally deployed BFF not provisioned |
| Wallet/identity | Real injected wallet connect, signed identity challenge/session, same wallet binding verified; no public-user-ID header shortcuts | Hosted authenticated E2E not verified |
| Pay | Wallet-owned direct Arc Testnet USDC transfer with receipt, exact Transfer log, gas, recipient checks, and owner ActivityReceipt | Beta transfer only; cloud recipient identity/receipt E2E pending |
| AI | Server-side model response and bounded credentials/cost, no canned response, clear explanation vs user-authorized on-chain execution | Current API is standalone, needs hosted key and end-to-end acceptance |
| Convert | Live short-lived quote, source asset and allowance review, slippage/expiry, wallet signature, on-chain settlement and receipt | Provider gate disabled; no signed real E2E |
| CCTP V2 Bridge | One Arc source burn, canonical single Circle message, attestation, one verified Sepolia/Base Sepolia receive, matching destination mint and immutable receipt; explicit crash recovery without reburn | Real wallet-signed E2E not witnessed |
| Destination retry | Any attempt #2 signing must pass audited nonce/revert/unknown-submission safety and be independently field tested; otherwise clearly disabled | Signing intentionally disabled |
| Activity & cross-device | Authenticated owner-only PostgreSQL receipts, ordered append-only bridge attempts; reload/new device consistent, no fake activity | Hosted session/database acceptance pending |
| Security/release | No leaked env/private key; CSP/CORS/rate limits, correct RPC chain IDs, anti-replay and fail-closed, provider security review, no accidental mainnet activation | Hosted acceptance/security sign-off pending |

## Backend container deployment

`Dockerfile.bff` is pinned to the repository's Bun version and intentionally
contains no local `.env`, credentials, tests, public frontend or database
migration performed on container startup. It runs `bun server/bff.ts`.

Deploy this as a **separate container service** (for example a container
platform capable of setting secrets and attaching managed PostgreSQL). The
container sets `VEYRA_ENV=testnet`, `NODE_ENV=production` and
`VEYRA_HOSTED_BACKEND=1`. The platform may set `PORT`, otherwise it
listens on 3001. Do not expose the BFF to users before migrations and health
checks pass.

Required server-only settings:

- `DATABASE_URL`: non-local PostgreSQL with TLS (`sslmode=require` or
  `verify-full`) or an explicitly private network with
  `VEYRA_DATABASE_PRIVATE_NETWORK=1`
- `VEYRA_SESSION_SECRET`: strong random secret, at least 32 characters
- `VEYRA_APP_ORIGIN`: exact HTTPS origin of the user-facing website (no
  wildcard); hosted testnet CORS permits that origin only
- `ARC_TESTNET_RPC_URL`, `ETH_SEPOLIA_RPC_URL`,
  `BASE_SEPOLIA_RPC_URL`: independently reviewed chain RPC endpoints
- `CIRCLE_API_KEY` and server-side AI/provider secrets only when the
  corresponding backend routes are ready to activate
- `RELAY_PRIVATE_KEY`: **absent by default**. Testnet relay key requires
  the explicit `VEYRA_ENABLE_TESTNET_RELAY=1` operator authorization and a
  separately audited gas-only key. Do not assume an empty nonce permits retry.

Run `bun run db:migrate` from a trusted, authenticated release job against
the approved database, followed by `bun run db:verify`. Do not run schema
migrations automatically on concurrent container startups. Check
`GET /api/health`, `/api/health/database` and the authenticated routes.
On horizontally scaled hosting, in-memory rate limits are insufficient;
configure WAF/distributed rate limiting before public access.

The current `vercel.json` is deliberately a guarded Vite frontend and
minimal AI function. **Do not enable full-stack browser execution or add a
`/api/*` forwarding rewrite until the exact BFF origin, HTTPS, CORS and
database readiness have all been verified.** A public health check alone is
not proof of identity or bridge readiness.

## Evidence policy

Capture *developer-operated* tests on every release candidate. Never
invent transaction IDs or copy unrelated transactions as acceptance proof.

For each signed testnet path attach to the PR or release record:

1. Source/destination testnet chain IDs, route/amount/token addresses,
   sanitized wallet IDs and release commit.
2. Actual source transaction hash, finality, canonical block hash and
   matching contract event; for CCTP, original message ID and Circle
   attestation; destination hash and verified USDC mint/amount delta.
3. BFF and PostgreSQL receipt reference, idempotency/retry results and
   redacted screenshots/log excerpts (no private keys or tokens).
4. Negative cases for disconnected wallet, wrong chain, expired quote,
   stale nonce, unknown submission, switched account and RPC failure.

A successful mocked-wallet unit test or Vercel `Ready` status is **not** an
E2E acceptance result.

## YouTube submission — only after release gates pass

Prepare a single video showcasing the **final deployed testnet version**,
not an old canned-response preview. Reconfirm the competition's exact
video length, language, upload visibility and submission link requirements
from the official rules **before publishing**. The current repository does
not establish those constraints, so they must not be guessed.

Proposed recording chapters (adjust to actual mandatory judging criteria):

1. Product intro: Veyra's identity → intent → route → safety → sign → receipt.
2. Show final deployed site and real wallet/identity connection.
3. Demonstrate AI response from a live backend; explain it cannot sign
   or choose unverified transaction calldata.
4. Perform a *small* wallet-authorized Arc Testnet USDC payment; show its
   exact on-chain proof and authenticated ActivityReceipt.
5. Demonstrate a full live Arc → Sepolia/Base Sepolia CCTP V2 transfer if
   its acceptance gates have passed, including attestation and destination
   mint evidence. Do **not** substitute animations for transactions.
6. Cover Convert only if a live, audited quote/settlement path exists;
   otherwise it is a documented incomplete feature and **not ready to
   present as an end-to-end product**.
7. Show crash-safe recovery on an approved non-duplicate scenario and
   GitHub architecture/README.
8. Closing: actual testnet deployment URL, repository commit, verified
   explorers, and clearly stated testnet-only limitations.

Publishing to the user's YouTube channel requires an authenticated YouTube
account/action; the user must approve the account connection and final public
upload when that milestone is reached. **Do not upload** while gates are red
or treat generated narration as a substitute for a real recording.

## Release decision

**RED / NOT YET COMPLETE** until every mandatory release gate has field
evidence. The assistant should finish as much coding, CI and infrastructure
as possible without repeatedly asking the user to deploy Preview builds.
When external infrastructure, credentials or a user-owned wallet signature
is unavoidable, record the exact blocker and request the minimum required
user action once at the release boundary.
