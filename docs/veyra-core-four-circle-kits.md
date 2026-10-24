# Veyra Core Four — phased Circle App Kit delivery policy

**Decision date:** 2026-10-16  
**Goal:** a simple, professional and useful self-custodial Veyra product,
with **Send / Pay → Unified Portfolio → Bridge → Swap** as the four visible
core user tasks. Existing Veyra ID and multilingual AI Assistant are
supporting features, not substitutes for reliable financial execution.

## Critical distinction: a portfolio is not Circle Gateway balance

A read-only **Unified Portfolio** displays wallet-held USDC across verified
chains by reading public USDC contracts. It needs no wallet transfer,
allowance, approval, deposit, or delegated signing. Display each chain
separately, then aggregate only fresh, verified observations and show
partial failures honestly. Use an explicit network label for every balance.
Do not claim this is a *Circle Gateway unified balance*.

Circle **Unified Balance Kit** operates a distinct pooled USDC balance
through Circle Gateway. `getBalances()` reports funds **deposited to the
Gateway balance**, **not** the total USDC still held in each user's external
wallet. `deposit()` and `spend()` move funds. The recovery-only fund
removal path has a **seven-day withdrawal delay** in current Circle
documentation. Never call these methods from the read-only Portfolio UI;
make Gateway opt-in only after an independent explicit consent and financial
release review. Never sum on-wallet and Gateway holdings without preventing
double counting.

Circle sources:
- https://github.com/circlefin/skills/blob/master/plugins/circle/skills/unify-balance/SKILL.md
- https://www.circle.com/gateway
- https://github.com/circlefin/docs-examples

## Delivery order, minimum useful release and acceptance

### 1. Send / Pay (finish current capability)
- Maintain Testnet default and isolated Mainnet read-only release.
- Keep exact chain, trusted USDC address, six-decimal amounts, sender and
  recipient checks, native-gas reserve, human wallet signature, receipt
  verification, and unknown-status retry lock.
- Next acceptance: real unfunded/testnet wallet browser E2E, sender/recipient
  mismatch, rejection, page reload and receipt recovery tests; **no**
  uncontrolled real-money trial. Web domain warning must be resolved
  through the appropriate provider before public wallet onboarding.

### 2. Unified Portfolio (next actual feature)
- Read USDC only on independently verified chains and addresses.
- Phase 7B start with EVM chains already documented in Veyra; choose each
  chain's actual contract and RPC, validate `eth_chainId`, `decimals()`,
  result types and browser CORS. Never infer a missing amount as zero.
- Show per-chain balances and a combined figure only if all components were
  read successfully at an acceptable freshness level; otherwise label it
  **Partial balance**, show last-updated timestamps and each unavailable
  chain. Never copy catalog-only assets into positions.
- No `kit.unifiedBalance.deposit()`, `spend()` or delegation in this phase.
  If Gateway is ever launched, give it a separate clearly labeled area.
- Acceptance: mocked adversarial RPC, live read-only RPC checks, cross-chain
  address validation, mobile UX and failure/recovery tests.

### 3. Bridge (after durable backend)
- Circle CCTP and Circle App Kit can help orchestrate USDC between networks;
  only present verified source/destination routes.
- Render BFF/Postgres readiness, authenticated wallet owner, exact quote,
  human approval, source burn evidence, Circle attestation, destination mint,
  idempotency, resume-after-crash and recovery receipts are release gates.
- Quote expiry, network fees, destination final amount, support status,
  wrong-chain/signature warnings and multi-step uncertainty must remain
  visible in plain English.
- Never use `transfer completed` for a source-only burn. Mainnet Bridge
  remains disabled until independent controlled low-value acceptance.

### 4. Swap (last core financial release)
- Same-chain token conversion, not the same thing as CCTP Bridge or Veyra's
  StableFX USDC/EURC conversion. Keep the labels clear.
- App Kit Swap can route through third-party aggregators; check route/token
  authenticity, network support, liquidity, quote TTL, slippage, fees,
  approvals, signed transaction and matching receipt.
- On Arc, native gas USDC and ERC-20 USDC represent the same underlying
  asset: **USDC ↔ NATIVE is a no-op, not a valid swap pair.**
- Offer quote/review mode first; no real signing until per-route security and
  E2E acceptance. Never silently generate an unlimited token approval.

Circle sources:
- https://github.com/circlefin/skills/blob/master/plugins/circle/skills/swap-tokens/SKILL.md
- https://github.com/circlefin/skills/blob/master/plugins/circle/skills/bridge-stablecoin/SKILL.md
- https://github.com/circlefin/docs-examples

## Product hierarchy and UX

- **One website, one wallet experience, two explicitly named environments.**
  Existing Veyra colors, typography and layout are frozen.
- User language: Send, Assets, Bridge, Swap; Agent and Veyra ID are nearby
  helpers. Internally existing `Convert` refers to gated StableFX and must
  not be relabeled as ready Swap without a route/quote engine.
- Only expose executable controls when provider, environment, real RPC,
  receipt policy and deployment are approved. Otherwise say **Preview**,
  **Read only**, **Coming later** or **Unavailable**, without fake APY,
  success status, rates or balances.

## Earn / Borrow / Onramp — deferred

There is no obligation to implement every Circle Kit to make a useful app.
Earn means third-party lending/vault exposure and variable, potentially
negative performance; not a savings product with Circle-guaranteed interest.
Borrow involves collateral liquidation; Onramp has geographical and
compliance dependencies. These features stay in **research-only branches**,
never in public finance menus or production execution bundles, until the
four core workflows are accepted. In particular the experimental
`phase7b-circle-earn-readonly-foundation` branch is not merged.

## Explicit safety boundary

Current branch `phase5-production-bridge-flow` is not Production. The
public `develop` Vercel deployment must not be upgraded automatically
until PR #7 and MetaMask/domain classification are reviewed.

No paid Render/Postgres resources or real-money signing is authorized by
this roadmap. The Circle App Kit `@circle-fin/app-kit` and
`@circle-fin/adapter-viem-v2` are already present in Veyra's dependencies;
adopt individual features through narrow reviewed adapters rather than
installing four competing complete SDK stacks.

**Next engineering increment:** verified multi-network **read-only USDC
wallet balances** first; only afterward independently consider Gateway's
separate pooled Unified Balance feature.
