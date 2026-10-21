# Changelog

Veyra follows an evidence-based release process. This is a **development
changelog**: features in merged Phase 5 PRs are **NOT necessarily deployed
to Production**. Financial release and provider enablement require separate
acceptance.

For original GitHub sources and commit SHAs see
[Development history](docs/DEVELOPMENT_HISTORY.md).

## Unreleased — Phase 8 documentation & repository integrity

- Rewrite README around **Veyra ID, friends, safe USDC Pay, Unified** and the
  distinction between working Testnet UI and server-only code.
- Introduce `SECURITY.md` (private disclosure guidance, trust boundaries,
  incident handling), `CONTRIBUTING.md` (test and release requirements) and
  a source-linked PR/commit record.
- Add repeatable repository-trust documentation checks to CI. No new
  financial permissions, Mainnet execution or infrastructure provisioning.

## 2026-10-16 — Phase 7E / 7D / 7C / 7B / 7A (Phase 5 branch only)

- **Pay-by-ID security:** native `@handle.veyra` namespace cannot be
  hijacked by an X alias or contact nickname. Ambiguous same-chain wallets
  fail closed; short-lived server-signed review proof ties authenticated
  sender to wallet ID, address, exact chain and snapshot.
- **Unified:** read-only wallet-held native USDC on Arc and Base across
  their reviewed Testnet/Mainnet network views. RPC errors are not zeros.
  Catalog metadata does not imply a balance or financial permission.
- **Wallet UX:** EIP-6963 provider icons with constrained inline data URLs,
  deterministic fallback, wallet search and more choices.
- **Product scope:** Send/Pay, Unified, Bridge and Swap prioritized. Earn,
  Onramp and Borrow deferred. Circle Gateway's deposited pooled balance
  is separate from wallet-held portfolio visibility.
- **Safety gate:** Mainnet reads and quote simulations only; signing off.
- Evidence: [#15](https://github.com/bearbaba/Veyra/pull/15),
  [#16](https://github.com/bearbaba/Veyra/pull/16),
  [#17](https://github.com/bearbaba/Veyra/pull/17),
  [#18](https://github.com/bearbaba/Veyra/pull/18),
  [#19](https://github.com/bearbaba/Veyra/pull/19).

## 2026-10-16 — Phase 6, candidate UX & production safety (Phase 5 branch only)

- Unified network selector with Testnet default and Mainnet safe read-only.
- CI Chromium desktop/mobile, real Arc Mainnet browser RPC acceptance and
  release-candidate bundle/security checks.
- Hosted Testnet backend/deployment blueprint and controlled migrations,
  with no claim that a database was publicly deployed.
- Evidence: [#8](https://github.com/bearbaba/Veyra/pull/8)–
  [#14](https://github.com/bearbaba/Veyra/pull/14). Phase 5 promotion
  [#7](https://github.com/bearbaba/Veyra/pull/7) remains **open**.

## 2026-10-10 — Phase 4A–4F (`develop`)

- Deterministic provider routing, financial review and risk gates.
- Circle App Kit adapters kept behind provider lifecycle and execution
  readiness, with anti-replay, verified receipt and CCTP recovery controls.
- PR [#1](https://github.com/bearbaba/Veyra/pull/1)–
  [#6](https://github.com/bearbaba/Veyra/pull/6) merged into `develop`.
- Last verified Production baseline commit:
  [`c7076668`](https://github.com/bearbaba/Veyra/commit/c707666827c724bd5d1bc8c07647692b86e7f85b).

---

A released feature requires **deployed SHA + CI + real environment acceptance**
rather than a roadmap entry. For the current blockers read
`docs/veyra-testnet-release-gates.md`.
