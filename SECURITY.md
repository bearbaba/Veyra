# Security policy

Veyra is an **experimental, self-custodial** Web3 product. Its current public
Preview is **Testnet-first**; real-money **Mainnet signing is disabled** in the
reviewed release candidate. Source-level protections and passing CI tests do
**not** constitute an independent audit or a financial guarantee.

**Snapshot warning (22 October 2026):** new identity, wallet selection and X-link PRs may be merged but **not deployed** to the stable Identity Beta URL. Check the [release status ledger](docs/veyra-release-status.md) before claiming a fix is live.

## Supported scope and disclosure boundaries

| Surface | State | Security expectations |
| --- | --- | --- |
| `develop` / current Vercel Production | Older static release, not current Phase 5 candidate | No automatic rollout of new financial features |
| `phase5-production-bridge-flow` (PR #7) | Under development/review | Default Testnet, capped Arc USDC Pay, Mainnet public observations and simulation only |
| Testnet Express BFF / PostgreSQL | Dedicated Render BFF and private Postgres hosted as an **experimental acceptance pilot**; financial E2E **not** accepted | Free database is not production-durable; exact origin, secrets, session ownership, backup/restore and operational monitoring gates remain |
| Provider adapters / Circle App Kit | Some implementation and simulated validation available | Presence of adapter does not mean live provider activation |
| Veyra ID / Friends / Pay by ID | Isolated hosted Identity Beta exists, but `INVALID_SIGNATURE` occurred with a real wallet; X OAuth and real two-wallet Friends not yet accepted; Pay by ID disabled | Require real signer, verified X link to **same** Veyra ID, immutable identity, address review token and fail-closed block policy |
| Mainnet financial execution | **Disabled** | Requires independent operational, provider, wallet, replay, gas/finality and signer acceptance |

**Never test with funded production wallets, private keys, seed phrases or
real-money Mainnet transfers.** A Testnet payment is still an irreversible
network action from that wallet's point of view. Use disposable wallets and
small amounts only after explicit permission.

## Report a vulnerability responsibly

**Please do not publish exploitable vulnerability details, secrets, or a
reproduction against users' live accounts in a public GitHub issue.**

1. Visit the repository's [Security tab](https://github.com/bearbaba/Veyra/security).
   If **Private vulnerability reporting** is available, use it to contact the
   maintainers privately.
2. If GitHub does not offer private vulnerability reporting, ask the repository
   maintainer for a secure reporting channel **without disclosing exploit
   details publicly**. Do not assume an address, inbox, bounty or response SLA
   exists unless the maintainers have explicitly published one.
3. Share a minimal reproduction using **disposable testnet identities and
   sanitized logs only**. Include affected git commit/deployment hostname,
   chain ID, risk, potential impact, prerequisites and affected endpoint. Do
   not include private keys, access tokens, database URLs, unredacted user
   wallet activity or unrelated personal information.
4. Allow time for responsible reproduction and remediation before any
   coordinated public disclosure. No bounty or reward is implied.

For ordinary non-security bug reports, open a public GitHub issue without
secrets, credentials or identifiable users.

## Threat model

| Trust boundary | Fail-closed control | Evidence |
| --- | --- | --- |
| Browser and wallet | EIP-6963 discovery does not authorize signing; review precedes a user's wallet signature | `src/preview/PreviewWallet.tsx`, `src/preview/arcTestnetPay.ts` |
| Testnet Pay | Fixed Arc chain + native USDC, exact decimals, 1-USDC cap, independent receipt/log and finality | `src/tests/phase5ArcTestnetBetaPay.test.ts`, `src/tests/phase5ArcTestnetPayJournal.test.ts` |
| Public Mainnet view | Read-only, chain-bound observations and simulation; no payment signer imported into shared Preview | `src/preview/PreviewMainnetSurfaces.tsx`, `scripts/check-unified-production-release.ts` |
| Arc/Base Unified | Source contract and chain pinned; failure means unavailable, not zero; no Gateway deposit | `src/tests/phase7dBaseUsdcReadOnly.test.ts`, `e2e/base-usdc-live-readonly.mjs` |
| Veyra ID | EIP-712 ownership proof, unique handle, immutable ID; external X is not wallet ownership | `server/services/identityRegistrationService.ts`, `server/services/veyraIdNamespace.ts` |
| Pay by ID | Sender-bound HMAC review token, exact wallet/address/chain, max 30s snapshot, recheck at review | `server/services/paymentReviewProof.ts`, `src/tests/phase7ePaymentReviewProof.test.ts` |
| Friends/social | Block overrides friendship; social relations never grant payment permission | `server/db/repositories/socialRepository.ts`, `server/services/paymentRecipientService.ts` |
| Bridge & receipts | Unique source burn evidence, immutable destination attempt/receipt state, fail-closed uncertain state | `docs/veyra-phase4f-crash-safe-cctp-recovery.md`, `docs/veyra-phase5-production-bridge-flow.md` |
| BFF & database | Exact approved Origin, authenticated owner sessions, no dev-header bypass, redacted health | `.github/workflows/ci.yml`, `docs/veyra-hosted-testnet-deployment.md` |
| Deployment boundary | Build isolation, explicit release gates, no Mainnet provider promotion from UI catalog | `vercel.json`, `scripts/check-unified-production-release.ts`, `src/providers/registry/mainnetProviderManifest.ts` |

Note: these are source-code controls, **not independent penetration-test
results**. Public RPC providers and wallet extensions remain independent trust
boundaries; availability and upstream compromise are not solved by local unit
tests. Smart contract wallet signature verification requires additional
scheme-specific work where EOA proofs alone are insufficient.

## Required security tests before a release

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run check:dev-isolation
bun run build
bun run check:prod-bundle
bun run check:repository-trust
```

CI must additionally validate the actual isolated Vercel bundle; disabled
Mainnet signing/providers; PostgreSQL migrations; BFF startup failure without
secrets; authentication, CORS and public health redaction; and desktop/mobile
Chromium acceptance. Arc/Base real-RPC browser probes verify **reads only**,
not signed financial acceptance. Test output, screenshots and tx proofs must
refer to the exact reviewed git commit.

A live wallet Testnet acceptance has its **own operator release gate**, and
must be documented with tx hash, chain, asset, amount, nonce/receipt/finality,
reviewed sender/recipient, and sanitized supporting evidence. A CI green badge
or `READY` Vercel deployment is not interchangeable with this evidence.

## Website security notices and phishing classifications

MetaMask and other wallet providers can warn about specific **origins**.
A Preview URL, the stable Production domain and an API hostname are distinct.
The project owner reported on **21 October 2026** that a previous warning
was lifted; the repository does not contain independent provider clearance
evidence for every current or future deployment. Do **not** label every
deployment "MetaMask-approved" or assume a cleared URL implies an audit.

If a warning appears again:
- stop wallet connection/signing; do not recommend disabling phishing checks;
- capture the exact URL, browser/extension version, timestamp and warning;
- privately investigate, then request the provider to review that exact URL;
- update release notes only after independently verifying the classification.

Previous review instructions: `docs/veyra-metamask-classification-review.md`.

## Operational incident procedure

1. Preserve sanitized evidence and identify exactly which environment, chain,
   wallet integration, build SHA and route are impacted.
2. Block risky financial feature promotion or turn off the affected provider
   through its reviewed policy gate. **Do not** attempt duplicate source
   transactions as a recovery shortcut.
3. Triage potential leaked keys/session tokens privately and rotate through
   the appropriate infrastructure owner. **Never commit** replacement secrets.
4. Prepare a minimal reviewed patch, add a regression test for the root
   cause, and run the complete release gate.
5. Obtain explicit operator sign-off to roll out. Mainnet remains disabled
   without its separate audited activation criteria.

See `docs/veyra-production-release-checklist.md` and
`docs/veyra-mainnet-release-gates.md` for promotion rules.
