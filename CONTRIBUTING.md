# Contributing to Veyra

Thank you for contributing to an open-source, **self-custodial, Testnet-first**
Web3 product. Veyra's promise is understandable USDC payments through
verified identities and friends. We value **correctness, reviewability and
user safety** over adding superficial features.

Please read [README.md](README.md) and [SECURITY.md](SECURITY.md) first.

## Where to contribute

- The GitHub default branch `develop` is the **older current Production
  baseline**, not the latest app.
- The active development release candidate is
  `phase5-production-bridge-flow` (open [PR #7](https://github.com/bearbaba/Veyra/pull/7)).
- For incremental work intended for the current release candidate, fork or
  branch from the **latest Phase 5 commit** and propose a **small PR** back to
  `phase5-production-bridge-flow`.
- Do **not** merge PR #7 into `develop` as a routine feature contribution.
  Production promotion is a separate, evidence-based operator decision.
- Unmerged research branches (including experimental Earn) are **not**
  official user-facing functionality and should not be added to navigation
  without acceptance.

## First local checks

Use the pinned Bun version from `.bun-version`, not a random package manager.

```bash
git clone https://github.com/bearbaba/Veyra.git
cd Veyra
git fetch origin
git checkout phase5-production-bridge-flow
git checkout -b fix/describe-your-change
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run check:repository-trust
```

To reproduce the public Testnet-first frontend:

```bash
VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build
bun run check:vercel-preview-bundle
```

For DB integration, use disposable **local Testnet-only PostgreSQL**; do not
modify user databases or run remote migrations for a PR without explicit
authorization. External RPC/browser CI may fail due to public rate limits:
include actual logs, do not bypass the checks or claim success.

## What a reviewable PR needs

- **One focused problem**, user impact and implementation overview.
- Scope and boundaries: Testnet vs Mainnet, frontend vs BFF, UI-only vs
  executable, source vs deployed. Clarify **what is still disabled**.
- A deterministic unit/security regression test for every new rule, e.g.
  wrong chain, recipient substitution, replay, malformed token, expired
  quote or RPC failure.
- If relevant, exact browser reproduction or authenticated local DB test.
  Never assert a real signed live transfer based solely on mock RPC.
- Versioned documentation updates for new features and user-visible
  behavior. Add an entry in `CHANGELOG.md`; retain the linked original PR
  in `docs/DEVELOPMENT_HISTORY.md` for meaningful milestones.
- CI green on the final commit; explicit risks, blockers and rollback notes.

The PR template includes a concise author checklist. Screenshots should
contain no secrets or personal financial information.

## Security invariants: changes must not weaken these

1. **No wallet action without user review and separate explicit signature.**
   A connected wallet, Veyra ID, friend, Agent intent, or session token is
   never authority to spend.
2. Keep the main public Preview **Testnet default**. Mainnet financial
   providers, signing, bridge and swap remain **disabled** until their
   independent activation gates are met.
3. Never replace `Unavailable` RPC balances with fabricated zeros, pretend
   quotes, fake APY, or fabricated receipts. Asset listings are metadata.
4. Tie Pay-by-ID to the **authenticated sender**, exact reviewed recipient
   wallet/chain, current identity revision and an expiring snapshot.
5. Prefer immutable evidence and fail-closed replay protection over automatic
   retries when a payment or CCTP burn result is uncertain.
6. Never expose private keys, `DATABASE_URL`, `OPENAI_API_KEY`, Circle keys,
   relay keys, sessions or payment review tokens to client bundles, `VITE_*`
   variables, GitHub PR bodies, logs or screenshots.
7. Bridge, Earn, Borrow and Swap adapters are **not executable simply because
   an SDK is installed**.

See `SECURITY.md`, `docs/veyra-testnet-release-gates.md`, and
`docs/veyra-mainnet-release-gates.md`.

## Testing hierarchy

| Level | What it can prove | What it cannot prove |
| --- | --- | --- |
| Typecheck + lint | Code quality and type constraints | Security in production |
| Unit/security tests | Boundary checks, deterministic mocks, adversarial inputs | Real wallet signing or settlement |
| PostgreSQL integration | Real schema, DB transaction and session behavior locally | Hosted API correctness |
| Bundle isolation | Forbidden frontend imports/signing APIs absent from selected build | Wallet provider trust |
| Chromium synthetic UI | Navigation, wrong-chain behavior, UI consistency on mobile | Live wallet transfer |
| Live public RPC read | CORS, chain ID, known token code/decimals/balance calls | Fund movement or reliable production RPC SLA |
| Manual Testnet E2E | Actual wallet-owned transaction and independently checked receipt | Automatically authorizes Mainnet |

Do not modify source to force tests to pass. Fix the root cause, add a
targeted negative test, and report any unavailable external dependencies.

## Privacy, branding and documentation

- UI text should be clear, concise, English by default. The AI Assistant can
  support additional languages without mixing translations in core labels.
- Keep the existing Veyra visual identity; avoid redesigning navigation for
  a single feature or filling the UI with disabled fake buttons.
- X integration is **optional**. Never import private X data without
  permission or treat an X handle as proof of wallet ownership.
- Public contribution history must link **real PRs and commits** and preserve
  the distinction between merged feature branches and Production releases.
  No fabricated activity, stars, transaction hashes, security approvals or
  fake testimonials.
- Do not post security exploits in public. Follow `SECURITY.md`.

## Maintainer release procedure

A maintainer should verify the exact target SHA, CI runs, browser evidence,
feature flags, independent RPC/receipt state, Production rollback and
security-warning status before approving any release PR. The default branch
may lag deliberately; that is not a reason to skip the release policy.

Contributions are welcome even without a wallet: docs, UX copy, unit tests,
accessibility, and read-only security checks all help.
