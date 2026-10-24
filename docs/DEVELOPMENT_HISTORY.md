# Veyra development history (source-linked)

**Evidence cutoff:** 21 October 2026. This is a human-readable map of
**actual GitHub pull requests**, not a fabricated activity log, benchmark,
audit report, endorsement or a claim that every feature is live.

- Repository: https://github.com/bearbaba/Veyra
- Original author/maintainer of PRs below: [@bearbaba](https://github.com/bearbaba).
- GitHub default branch `develop`: last confirmed Production baseline at
  `c707666827c724bd5d1bc8c07647692b86e7f85b` (PR #6).
- Active upgrade: `phase5-production-bridge-flow`, currently
  `6a14a66724f1cbb6616e42a710ff528552879750`,
  with [PR #7](https://github.com/bearbaba/Veyra/pull/7) still **OPEN**.
- Merging PRs **#8–#19 into Phase 5 did NOT merge them into `develop`**.
  A GitHub merge is also not proof of deployment or a security audit.

## 10 October 2026 — architecture and transaction safety on `develop`

| PR | Verified contribution | Merged to |
| --- | --- | --- |
| [#1](https://github.com/bearbaba/Veyra/pull/1) | Phase 4A: capability engine and universal routing | `develop` |
| [#2](https://github.com/bearbaba/Veyra/pull/2) | Phase 4B: Circle App Kit adapters, deterministic routes, recovery, fees, treasury | `develop` |
| [#3](https://github.com/bearbaba/Veyra/pull/3) | Phase 4C: readiness, verified receipts and durable bridge state | `develop` |
| [#4](https://github.com/bearbaba/Veyra/pull/4) | Phase 4D: provider lifecycle, promotion evidence and asset/network limits | `develop` |
| [#5](https://github.com/bearbaba/Veyra/pull/5) | Phase 4E: App Kit execution safety, anti-replay and exact receipt checks | `develop` |
| [#6](https://github.com/bearbaba/Veyra/pull/6) | Phase 4F: crash-safe CCTP recovery, transaction evidence and CI isolation | `develop` |

**Production marker:** PR #6 merged on **10 October 2026**, resulting in
commit [`c7076668`](https://github.com/bearbaba/Veyra/commit/c707666827c724bd5d1bc8c07647692b86e7f85b).
Later improvements below are **release candidates**, not yet delivered to
Production merely because they passed CI.

## 16 October 2026 — Phase 5 / Phase 6 readiness work

| PR | Verified contribution | Merged to |
| --- | --- | --- |
| [#7](https://github.com/bearbaba/Veyra/pull/7) | Combined Phase 5 proposed release: routing, immutable ActivityReceipt lifecycle and provider boundaries | **OPEN → `develop`**, not merged |
| [#8](https://github.com/bearbaba/Veyra/pull/8) | Mainnet readiness hardening, financial execution still disabled | `phase5-production-bridge-flow` |
| [#9](https://github.com/bearbaba/Veyra/pull/9) | Hosted Testnet BFF + private Postgres deployment blueprint; no paid resources created by PR | `phase5-production-bridge-flow` |
| [#10](https://github.com/bearbaba/Veyra/pull/10) | Isolated Arc Mainnet USDC Pay simulation MVP, signing disabled | `phase5-production-bridge-flow` |
| [#11](https://github.com/bearbaba/Veyra/pull/11) | Unified Testnet/Mainnet single-site workspace | `phase5-production-bridge-flow` |
| [#12](https://github.com/bearbaba/Veyra/pull/12) | Release headers, bundle isolation and promotion runbook | `phase5-production-bridge-flow` |
| [#13](https://github.com/bearbaba/Veyra/pull/13) | Chromium desktop/mobile acceptance and mobile network labels | `phase5-production-bridge-flow` |
| [#14](https://github.com/bearbaba/Veyra/pull/14) | Real Arc Mainnet RPC reads verified from Chromium, no funds | `phase5-production-bridge-flow` |

## 16 October 2026 — product identity and honest asset visibility

| PR | Verified contribution | Merged to |
| --- | --- | --- |
| [#15](https://github.com/bearbaba/Veyra/pull/15) | Phase 7A: wallet provider identity and searchable Unified asset/network directory | `phase5-production-bridge-flow` |
| [#16](https://github.com/bearbaba/Veyra/pull/16) | Phase 7B: Send/Pay → read-only Unified → Bridge → Swap priorities; Earn postponed | `phase5-production-bridge-flow` |
| [#17](https://github.com/bearbaba/Veyra/pull/17) | Phase 7C: `@handle.veyra` namespace and safe multi-wallet recipient selection | `phase5-production-bridge-flow` |
| [#18](https://github.com/bearbaba/Veyra/pull/18) | Phase 7D: Arc + Base **native USDC read-only** balance inspection | `phase5-production-bridge-flow` |
| [#19](https://github.com/bearbaba/Veyra/pull/19) | Phase 7E: exact authenticated sender/recipient wallet/chain binding for Pay-by-ID review | `phase5-production-bridge-flow` |

The merge of [PR #19](https://github.com/bearbaba/Veyra/pull/19)
produced commit [`6a14a667`](https://github.com/bearbaba/Veyra/commit/6a14a66724f1cbb6616e42a710ff528552879750).
GitHub CI on that commit completed successfully
([run 38886086612](https://github.com/bearbaba/Veyra/actions/runs/38886086612),
[run 38886081517](https://github.com/bearbaba/Veyra/actions/runs/38886081517)).
These are automated checks, **not** a production audit or evidence that
Veyra ID payments worked with real Testnet wallets.

## 21 October 2026 — documentation and trustworthiness pass

Work in the new Phase 8 contribution PR updates the public README,
security disclosure guidance, development workflow, release changelog
and source-linked history. Its own PR, build SHA and CI result should be
recorded **after** review; do not backdate or misrepresent work as a
Production release.

## Remaining honest release blockers

- [ ] Securely host authenticated Testnet BFF + migrated PostgreSQL and
      independently test real user sessions.
- [ ] Prove friends, Veyra ID and Pay-by-ID with two real disposable Testnet
      wallets, address review/identity revision, receipts and reload.
- [ ] Observe final real-wallet Arc Testnet payment and recovery acceptance.
- [ ] Independently approve Bridge/Swap providers, if/when released.
- [ ] Verify production domain/wallet classification and cross-browser UX.
- [ ] Review rollback and **explicitly** merge Phase 5 PR #7 into `develop`
      if the operator chooses to ship the full candidate.
- [ ] Keep Mainnet signing off until separate production security gates pass.

## How to verify this history

1. Follow each **PR link** to see code diffs, author, review and merge target.
2. Inspect the [commit history of Phase 5](https://github.com/bearbaba/Veyra/commits/phase5-production-bridge-flow/)
   and [`develop` history](https://github.com/bearbaba/Veyra/commits/develop/)
   **separately**.
3. Check [GitHub Actions](https://github.com/bearbaba/Veyra/actions)
   by exact SHA, not only by a green badge.
4. For security or finance features, compare source + test evidence with
   `docs/veyra-testnet-release-gates.md` and the actual deployed URL.
5. Do not mistake a commit timestamp, number of tests or automated GitHub
   activity for community adoption, audited safety or real settlement.
