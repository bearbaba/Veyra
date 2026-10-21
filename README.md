# Veyra

**Your Identity. Your Friends. Your Money.**

Veyra is an open-source, **self-custodial** Web3 application for paying people in USDC. Its distinguishing idea is **Veyra ID**: a human-readable identity that can connect verified wallets, friends, and payments without forcing people to memorize long wallet addresses.

Arc is Veyra's home network. Circle USDC and its infrastructure are useful building blocks, **not** an endorsement or a guarantee of swaps, yields, or third-party protocols.

> **Release status (21 October 2026):** active development. The current Vercel Production branch (`develop`) is older than the **Phase 5 release candidate** (`phase5-production-bridge-flow`, PR [#7](https://github.com/bearbaba/Veyra/pull/7)). Testnet-first Preview features are not equivalent to a deployed authenticated full-stack product, and **Mainnet financial execution is not enabled**. There is **no claim of an independent security audit**.

## What can I do today?

This table describes the **Phase 5 candidate**, not a promise that every feature is present on the older Production deployment.

| Experience | Current implementation | Important limit |
| --- | --- | --- |
| **Wallet Connect** | Detect EIP-6963/EIP-1193 browser wallets; explicit account permission | Wallet connection **does not** authorize payment |
| **Send & Pay** | Direct wallet-approved **Arc Testnet USDC** transfer and independent onchain receipt check | Maximum **1 testnet USDC per transfer**, not Veyra-ID Pay |
| **Unified** | Public, read-only wallet-held **USDC on Arc and Base** in Testnet/Mainnet views | Not Circle Gateway pooled balance; RPC failures show unavailable; other assets are catalog metadata |
| **Veyra ID** | Server-side signed ownership claims, profiles, X linking, contacts, friendship graph, exact recipient review tokens | Full login, Friends and Pay-by-ID require a hosted authenticated backend and PostgreSQL; **not live** on static Vercel Preview |
| **AI Assistant** | Informational endpoint via a separately protected Vercel function if configured | Not a signer, financial executor, or substitute for an exact quote |
| **Activity** | Local Testnet payment journal and recovery in public Preview; durable owner-scoped receipts in backend source | Cross-device backend receipts **not hosted** in static Preview |
| **Bridge / Convert / Swap / Earn** | Provider adapters and isolated recovery, verification, or simulation code exist | **Not active** public financial routes; Earn/Borrow/Onramp are deferred |

Only **Testnet** is intended for wallet-approved transfers in the current Preview. The **Mainnet tab is read-only**, with public onchain USDC observations and simulations that never submit transactions. Browsing a catalog never enables a token, provider, or chain for trading.

## How Veyra ID works

```text
Create @alice.veyra
       ↓
Prove wallet ownership (separate authentication signature)
       ↓
Find a friend → Request connection → Accept
       ↓
Send USDC → Resolve verified wallet & exact destination chain
       ↓
Review full address, amount, token and fees
       ↓
Confirm in your own wallet → Verify the onchain receipt
```

The `.veyra` suffix is a **Veyra application handle**, **not** a registered DNS or ENS domain. Behind the handle is an immutable internal user ID. One account may connect several verified wallets, but Veyra must **refuse** ambiguous same-chain recipient wallets. Payment reviews bind an authenticated sender to the selected wallet ID/address, chain and a short-lived, **30-second** identity snapshot. Friend status, messages and the AI Assistant confer **no signing authority**.

**Currently available:** the server-side foundation and its tests. **Still needed:** deployed BFF/PostgreSQL, real two-wallet Testnet integration, session/replay tests and browser evidence before presenting Pay-by-ID as live.

## Architecture at a glance

```text
Veyra Web (React + Vite + TypeScript)
  ├─ Wallet access via EIP-6963 / EIP-1193
  ├─ Direct capped Arc Testnet USDC Pay (isolated public Preview)
  ├─ Arc + Base public USDC balance readers (no signatures)
  └─ Review and status UI
             │ separately deployed HTTPS API (NOT in static Preview)
             ▼
Express BFF (Bun) ─ Authenticated sessions / Veyra ID / Friends
             │       Signed recipient review / Financial policy gates
             ▼
        PostgreSQL ─ Immutable receipt & recovery records
             │
             ▼
     Reviewed RPC, USDC & Circle service integrations
```

Money-moving design invariant: **Identity → Intent → Route → Safety → Sign → Receipt**. The wallet holds the authority to sign. An SDK result or a successful UI animation is **not** proof that settlement completed.

Veyra does not copy wallet-held USDC into a Circle Gateway balance. Gateway `deposit()` and `spend()` involve fund movement and would require separate, explicit user consent and audited release gates. See [Core Four product priorities](docs/veyra-core-four-circle-kits.md).

## Run locally

Requirements: Bun version in [`.bun-version`](.bun-version), a supported browser, and a disposable PostgreSQL instance **only** for identity/backend integration.

```bash
git clone https://github.com/bearbaba/Veyra.git
cd Veyra
git checkout phase5-production-bridge-flow
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
```

For the isolated, Testnet-first UI:

```bash
VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build
bun run check:vercel-preview-bundle
bun run preview
```

For local full-stack development (two terminals, **no Mainnet funds**):

```bash
# Terminal 1: configure a local disposable DB and server-only env first
bun run server
# Terminal 2
bun run dev
```

Running `bun run server` without the required secrets/database does not activate identity. Migrations are **an explicit administrative step**, not a side effect of the frontend or container starting. Follow the [hosted Testnet deployment guide](docs/veyra-hosted-testnet-deployment.md) before connecting the public web to the BFF.

Do not put secrets in `VITE_*` variables, frontend code, PR comments, screenshots or logs.

## Quality and security gates

CI checks TypeScript, static analysis, Vitest with PostgreSQL integration, production bundle isolation, the capped Testnet signer, disabled Mainnet signing, hosted BFF startup/auth/CORS/secret failure, and desktop/mobile Chromium acceptance. It also probes **real Arc and Base public RPCs** in a **read-only browser**, without using a funded wallet or executing transactions.

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:dev-isolation
bun run check:prod-bundle
bun run check:repository-trust
```

A **green CI check is not an audit** and not evidence of a signed, live, end-to-end transfer. For critical paths, we separately require a real Testnet wallet acceptance and independently verified receipt, plus a hosted backend where needed.

**Threats we explicitly design against:** chain mismatch, wrong recipient, forged identity or contact alias, tampered review/quote, unexpected token contract, malicious network metadata, replay or duplicate bridge burn, stale/double-submitted transaction, and a frontend unintentionally importing Mainnet signing.

Read [Security policy and incident reporting](SECURITY.md) and the [release gate checklist](docs/veyra-testnet-release-gates.md). Please **do not bypass MetaMask or other wallet security warnings**; treat any new warning as a separate blocking incident until checked.

## Release status and roadmap

1. **Now:** stabilize Testnet Pay and honest Arc/Base Unified balances; finish security, README and reproducible evidence.
2. **Next:** deploy authenticated **Veyra ID + Friends + Pay by ID** on Testnet after PostgreSQL and wallet-signed acceptance.
3. **Then:** independently accept Circle CCTP Bridge and same-chain Swap; Convert remains a distinct StableFX capability.
4. **Later:** optional messaging, friend QR/code, Onramp, Earn and Borrow only where safe, legally available and genuinely useful.

The current **Production** deployment is intentionally not automatically advanced with each development PR. Promotion requires the operator's reviewed release plan, a rollback path, domain/wallet safety review, and separate Mainnet controls. Never infer that the entire Phase 5 branch is running on the public Production hostname.

## Documentation and contribution history

- [Technical architecture](docs/veyra-architecture-v2.md)
- [Security policy](SECURITY.md) · [Contribution guide](CONTRIBUTING.md)
- [Development history — verified PRs #1–#19](docs/DEVELOPMENT_HISTORY.md) · [Changelog](CHANGELOG.md)
- [Veyra ID / Friends design](docs/veyra-id-friends-pay-foundation.md) · [Pay-by-ID exact review binding](docs/veyra-phase7e-payment-review-binding.md)
- [Arc/Base balance acceptance](docs/veyra-phase7d-arc-base-usdc-portfolio.md)
- [Testnet release criteria](docs/veyra-testnet-release-gates.md) · [Mainnet release criteria](docs/veyra-mainnet-release-gates.md)
- [CI workflows](.github/workflows/ci.yml) · [Open release PR #7](https://github.com/bearbaba/Veyra/pull/7)

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep all changes reviewable on a feature branch, and **do not publish private security vulnerabilities as public GitHub issues**.

---

**Veyra — Your Identity. Your Friends. Your Money.**

*Built for understandable, user-reviewed payments. Testnet-first. No custody and no promised yields.*
