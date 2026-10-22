# Veyra release truth & Mainnet promotion gate

**Snapshot: 22 October 2026. Not an authorization to transfer real money.**

This is an operator-facing status ledger. A passing CI workflow or merged PR
means source-level verification only, **not** approval of a real-wallet flow.
One canonical Veyra ID must own the wallet and X/social identity proofs; wallet
ownership alone authorizes neither a payment nor a Mainnet promotion.

## Which surface is actually running?

| Surface | Grounded state | What must not be inferred |
|---|---|---|
| Existing financial Vercel Production | Older isolated frontend associated with `develop`; Mainnet pay disabled | Latest Phase 5 identity commits are **not** automatically running there |
| Identity & Friends Beta | Dedicated `veyra-identity-friends-beta.vercel.app`; most recent confirmed READY deploy from `phase8h-identity-beta-vercel-host`, SHA `451b207` | Browser is **not yet** running newer fixes in PRs #37/#38/#39/#40, nor pending wallet-selector changes |
| Testnet BFF | Hosted at `veyra-testnet-acceptance-bff.onrender.com`, live Render deploy SHA `f1d17c5`; private PostgreSQL linked | Availability / healthy DB is **not** owner session, X OAuth, USDC payment or Mainnet acceptance |
| Staged Identity Beta source | Hosting branch `phase8m-hosted-identity-x-link` staged; source fixes reviewed on Phase 5 | Until a READY, domain-aliased Vercel deploy is checked, refreshed browsers still use older code |
| Render Free PostgreSQL | Testing infrastructure only; expires **20 Nov 2026** and lacks production backup guarantees | Not a long-term Mainnet ledger |

Vercel deployment API currently returned **402 `api-deployments-free-per-day`**.
Do not work around this by deploying the identity pilot onto the financial
production alias, reducing security checks, changing billing without explicit
operator approval, or claiming the new build is live.

## Core identity model — nonnegotiable invariant

1. `veyr_user_id` is the immutable internal authority for the Veyra profile.
2. A wallet is a separately proven binding using a fresh EIP-712 challenge.
   Account, chain, signer, nonce and replay defenses must be checked **both**
   before the browser POST and again by the backend.
3. X account linking is a **separate** OAuth 2.0 PKCE authorization from an
   existing authenticated Veyra session. Bind X's stable numeric account ID
   to the *same* `veyr_user_id`; changes to @handles do not create new IDs.
4. X OAuth grants neither the ability to sign with wallets nor to pay by ID.
   A changed wallet, blocked user, revoked social link or ambiguous destination
   fails closed. Never infer payment authorization from friendship, avatar or X.
5. An identity profile must be owner-scoped; backend claims remain authoritative
   regardless of frontend preflight or EIP-6963 wallet branding.

## Release checklist (unfulfilled requirements stay explicit)

| Gate | Current evidence | Promotion condition |
|---|---|---|
| Source quality | Phase 5 CI exercises typecheck, lint, isolated bundles, integration tests and browser smoke; PR #40 CI passed | CI of **exact release SHA** passes |
| Wallet login | Real browser saw `register/challenge 201`, then `register/complete 401 INVALID_SIGNATURE`; tests with disposable CI wallets pass | Two distinct real browser wallets register/sign in and re-login; no signature mismatch; account-switch/replay negatives |
| Extension selection | Local signer preflight merged PR #39; explicit EIP-6963 choice implemented for review in PR #41 | Isolated Beta deployment READY and tested with simultaneous MetaMask/Rabby installations |
| X linking | OAuth PKCE backend and linked identity schema exist; Beta UI PR #40 merged | Server secrets and exact X app callback configured; consent callback + owner profile reload succeed with a real X account |
| Friends | Signed-session backend tests and private Postgres integration exist | Real two-wallet invite, accept, block/unblock and reload acceptance with owner-only reads |
| Pay by Veyra ID | Source-level review and address/chain binding; no hosted signed financial E2E accepted | Real **Testnet** wallet-to-wallet USDC receipt, exact destination, no double-send, failures/reload/races tested |
| Infrastructure | Render Free / private DB pilot and stable Beta hostname exist | Managed durable production database with restore drill, logs/alerts, incident and rollback tests |
| Mainnet money movement | Explicitly **disabled** | Independent security review + all applicable `docs/veyra-mainnet-release-gates.md` gates + operator release authorization |
| CCTP / Swap / Convert / Earn | Provider code and/or simulations are **not release evidence** | Separate route-specific safety gates and actual settlement receipts; no bundled activation |

## Immediate ordering

1. Keep **Mainnet payment disabled** and preserve existing production domain.
2. Clear Vercel deploy quota through normal provider controls; deploy only
   the dedicated Identity Beta release SHA and verify its live alias/headers.
3. Investigate the observed `INVALID_SIGNATURE` using **no** seed phrases,
   raw EIP-712 signatures, OAuth codes or claim tokens in issues or chat.
   Prove EIP-6963 provider selection with two installed wallets.
4. Complete same-ID Wallet → X OAuth → Friends acceptance using two genuine
   browser sessions. Capture sanitized screenshots, backend error codes,
   timestamps, exact deployed SHA and testnet network ID.
5. Then implement/accept Pay by Veyra ID with a small Testnet USDC transfer,
   exact recipient review and authoritative receipt under disabled Mainnet.
6. Only then plan funded Mainnet canary with backups, incident response,
   replay/signer review, external security assessment and an operator-approved
   controlled launch. Bridge and Convert require **independent** gates.

**Red lines:** no real-money transfer based on passing CI; no automatic
resubmission of an unknown transaction; no second Veyra account from linking X;
no secrets or token/claim leakage; no unreviewed provider enablement; no claims
of an independent audit or production launch that did not happen.

For the complete detailed financial operator requirements see
[`docs/veyra-mainnet-release-gates.md`](veyra-mainnet-release-gates.md).
